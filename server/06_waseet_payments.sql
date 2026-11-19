-- Cash payments received from Waseet. Each one is deducted from the
-- "Collect from Waseet" balance in the app. Parcels and shipments are not
-- touched: a payment only lowers the total.
create table if not exists public.waseet_payments (
  id          bigserial primary key,
  paid_on     date not null default current_date,
  amount      numeric(12,2) not null check (amount > 0),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists waseet_payments_paid_on on public.waseet_payments (paid_on desc);

alter table public.waseet_payments enable row level security;
drop policy if exists waseet_pay_read on public.waseet_payments;
create policy waseet_pay_read on public.waseet_payments for select using (sees_money());
drop policy if exists waseet_pay_write on public.waseet_payments;
create policy waseet_pay_write on public.waseet_payments for all using (sees_money()) with check (sees_money());

grant select, insert, update, delete on public.waseet_payments to authenticated;
grant usage, select on sequence public.waseet_payments_id_seq to authenticated;
