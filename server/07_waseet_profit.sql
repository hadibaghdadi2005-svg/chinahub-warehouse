-- Waseet profit: $1 per order sent to Waseet, counted from 2026-11-19 on.
-- Every send is recorded here by a trigger (parcels going to "released",
-- shipments getting delivery_to = 'waseet'). The app groups the sends into
-- orders: one client per day, one 1941515 quotation per day (from the
-- quotation sheet), one shipping client per day. Taking a parcel or shipment
-- back out of Waseet (not delivering it) cancels its send.
create table if not exists public.waseet_sends (
  id         bigserial primary key,
  sent_on    date not null default (now() at time zone 'Asia/Beirut')::date,
  kind       text not null check (kind in ('parcel', 'ship')),
  ref        text not null,          -- parcel barcode or shipment number
  client_key text,                   -- parcel client_id, or shipment client
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  undone_at  timestamptz
);
create index if not exists waseet_sends_day on public.waseet_sends (sent_on desc);
create index if not exists waseet_sends_ref on public.waseet_sends (kind, ref) where active;

alter table public.waseet_sends enable row level security;
drop policy if exists waseet_sends_read on public.waseet_sends;
create policy waseet_sends_read on public.waseet_sends for select using (sees_money());
grant select on public.waseet_sends to authenticated;
grant usage, select on sequence public.waseet_sends_id_seq to authenticated;

create or replace function public.waseet_send_parcel_tr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'released' and (tg_op = 'INSERT' or old.status is distinct from 'released') then
    insert into waseet_sends (kind, ref, client_key) values ('parcel', new.barcode, new.client_id);
  elsif tg_op = 'UPDATE' and old.status = 'released' and new.status not in ('released', 'delivered') then
    update waseet_sends set active = false, undone_at = now()
     where kind = 'parcel' and ref = new.barcode and active;
  end if;
  return null;
end $$;

drop trigger if exists waseet_send_parcel on public.parcels;
create trigger waseet_send_parcel after insert or update of status on public.parcels
  for each row execute function public.waseet_send_parcel_tr();

create or replace function public.waseet_send_ship_tr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.delivery_to = 'waseet' and (tg_op = 'INSERT' or old.delivery_to is distinct from 'waseet') then
    insert into waseet_sends (kind, ref, client_key)
    values ('ship', new.ship_num::text, coalesce(nullif(btrim(new.client), ''), new.code, new.ship_num::text));
  elsif tg_op = 'UPDATE' and old.delivery_to = 'waseet' and new.delivery_to is distinct from 'waseet' then
    update waseet_sends set active = false, undone_at = now()
     where kind = 'ship' and ref = new.ship_num::text and active;
  end if;
  return null;
end $$;

drop trigger if exists waseet_send_ship on public.shipments;
create trigger waseet_send_ship after insert or update of delivery_to on public.shipments
  for each row execute function public.waseet_send_ship_tr();
