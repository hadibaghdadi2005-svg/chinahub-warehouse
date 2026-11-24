-- Waseet balance additions: an amount added to what Waseet owes without any
-- order behind it. Kept in waseet_payments as a negative amount, so a
-- payment (positive) is taken off the balance and an addition (negative)
-- goes on it. The app shows the two apart.
alter table public.waseet_payments drop constraint if exists waseet_payments_amount_check;
alter table public.waseet_payments add constraint waseet_payments_amount_check check (amount <> 0);
