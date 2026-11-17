-- Hamra clients: who always collects from the Hamra office, and a phone
-- notification when one of their parcels is received at the warehouse
-- instead of going to Hamra.
--
-- hamra_clients     the list. state 'on' = a Hamra client; 'no' = suggested
--                   once and turned down, so it is not suggested again.
-- hamra_alerts      one row per parcel that arrived for a Hamra client.
--                   sent_at is set once the notification has gone out.
-- push_subscriptions  one row per phone/browser that turned notifications on.
-- app_secrets       server-only values (the push signing key). No policies:
--                   only the service role (the edge function) can read it.

create table if not exists hamra_clients (
  client_id text primary key,
  customer  text,
  state     text not null default 'on' check (state in ('on', 'no')),
  added_by  uuid default auth.uid(),
  added_at  timestamptz not null default now()
);
alter table hamra_clients enable row level security;
create policy hamra_clients_read on hamra_clients
  for select to authenticated using (my_role() is not null);
create policy hamra_clients_write on hamra_clients
  for all to authenticated using (sees_money()) with check (sees_money());

create table if not exists hamra_alerts (
  barcode    text primary key,
  client_id  text,
  customer   text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
alter table hamra_alerts enable row level security;
create policy hamra_alerts_read on hamra_alerts
  for select to authenticated using (sees_money());

create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid(),
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy push_own_read on push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy push_own_insert on push_subscriptions
  for insert to authenticated with check (user_id = auth.uid() and sees_money());
create policy push_own_update on push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own_delete on push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

create table if not exists app_secrets (
  name  text primary key,
  value text not null
);
alter table app_secrets enable row level security;
revoke all on app_secrets from anon, authenticated;

-- A parcel for a Hamra client becomes received or shelved outside Hamra:
-- queue one alert for it (once per parcel, ever).
create or replace function hamra_alert_tr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('received', 'shelved')
     and (TG_OP = 'INSERT' or old.status not in ('received', 'shelved'))
     and coalesce(new.zone, '') <> 'HAMRA'
     and coalesce(new.client_id, '') <> ''
     and exists (select 1 from hamra_clients h where h.client_id = new.client_id and h.state = 'on')
  then
    insert into hamra_alerts (barcode, client_id, customer)
    values (new.barcode, new.client_id, new.customer)
    on conflict (barcode) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists hamra_alert on parcels;
create trigger hamra_alert after insert or update of status on parcels
  for each row execute function hamra_alert_tr();

-- Everything the Hamra page shows, in one call.
--   waiting      parcels of listed clients that are here, not at Hamra
--   clients      the list, with how often each has used Hamra
--   suggestions  clients who went to Hamra at least twice and (almost) only
--                there, not yet on the list or turned down
create or replace function hamra_overview() returns jsonb
language sql stable security invoker set search_path = public as $$
with sent as (
  select p.client_id, count(distinct e.barcode) n, max(e.at) last_at
  from parcel_events e join parcels p on p.barcode = e.barcode
  where e.to_status = 'at_branch' and coalesce(p.client_id, '') <> ''
  group by 1
), per as (
  select client_id, max(customer) customer,
         count(*) filter (where status in ('delivered', 'released', 'at_branch')) out_n,
         count(*) filter (where status in ('received', 'shelved')) here_n
  from parcels where coalesce(client_id, '') <> '' group by 1
), w as (
  select p.barcode, p.client_id, p.customer, p.status, p.zone, p.shelf, p.received_at
  from parcels p join hamra_clients h on h.client_id = p.client_id and h.state = 'on'
  where p.status in ('received', 'shelved') and coalesce(p.zone, '') <> 'HAMRA'
)
select jsonb_build_object(
  'waiting_count', (select count(*) from w),
  'waiting', coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc nulls last)
                        from (select * from w order by received_at desc nulls last limit 500) x), '[]'),
  'clients', coalesce((select jsonb_agg(jsonb_build_object(
        'client_id', h.client_id,
        'customer', coalesce(per.customer, h.customer),
        'hamra', coalesce(sent.n, 0), 'out', coalesce(per.out_n, 0),
        'here', coalesce(per.here_n, 0), 'last', sent.last_at::date,
        'added_at', h.added_at::date) order by coalesce(per.customer, h.customer))
      from hamra_clients h
      left join sent on sent.client_id = h.client_id
      left join per on per.client_id = h.client_id
      where h.state = 'on'), '[]'),
  'suggestions', coalesce((select jsonb_agg(jsonb_build_object(
        'client_id', sent.client_id, 'customer', per.customer,
        'hamra', sent.n, 'out', per.out_n, 'here', per.here_n,
        'last', sent.last_at::date) order by sent.n desc, per.customer)
      from sent join per on per.client_id = sent.client_id
      where sent.n >= 2 and sent.n::numeric / greatest(per.out_n, 1) >= 0.8
        and not exists (select 1 from hamra_clients h where h.client_id = sent.client_id)), '[]')
);
$$;
grant execute on function hamra_overview() to authenticated;

-- Every 30 seconds, if any alert is waiting, ask the hamra-push edge function
-- (server/functions/hamra-push) to send it. The push signing keys live in
-- app_secrets (vapid_public, vapid_private, vapid_subject); they are not in
-- this file.
create extension if not exists pg_net;
select cron.schedule('hamra-push', '30 seconds', $job$
  select net.http_post(
    url := 'https://llarspjcyvqzylxjxlld.supabase.co/functions/v1/hamra-push',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb)
  where exists (select 1 from public.hamra_alerts where sent_at is null)
$job$);
