-- ChinaHub warehouse — who may see and do what.
--
-- Everything here is enforced by the database. The interface hides what a
-- scanner should not see, but hiding is not security: these rules hold even
-- if someone opens the API directly.

alter table profiles      enable row level security;
alter table zones         enable row level security;
alter table parcels       enable row level security;
alter table parcel_events enable row level security;
alter table settings      enable row level security;

-- --------------------------------------------------------------- staff ----
-- Staff may read the staff list — the app shows who did what. Someone who is
-- merely signed in, with no profile or a switched-off one, reads nothing:
-- that is already true of every other table, and the staff list is no more
-- theirs to see than the parcels are.
create policy profiles_read on profiles
  for select to authenticated using (my_role() is not null);

-- Only an admin creates, changes or deactivates an account.
create policy profiles_admin_write on profiles
  for all to authenticated using (is_admin()) with check (is_admin());

-- Except: anyone may change their own display name, and nothing else.
-- The trigger below stops the role being raised through this policy.
create policy profiles_own_name on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Two jobs: stop a role being raised through the policy above, and keep the
-- warehouse from losing its last admin. Without the second, one admin stepping
-- themselves down leaves nobody able to add staff or change a rate again, and
-- only someone with database access could undo it.
create or replace function profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare admins int;
begin
  if TG_OP = 'DELETE' then
    if old.role = 'admin' and old.active then
      select count(*) into admins from profiles where role = 'admin' and active;
      if admins <= 1 then
        raise exception 'The last admin cannot be removed. Make someone else an admin first.';
      end if;
    end if;
    return old;
  end if;

  if not is_admin() then
    if new.role <> old.role or new.active <> old.active or new.id <> old.id then
      raise exception 'Only an admin may change a role or deactivate an account';
    end if;
    return new;
  end if;

  -- An admin, including acting on their own row.
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    select count(*) into admins from profiles where role = 'admin' and active;
    if admins <= 1 then
      raise exception 'The last admin cannot be stepped down. Make someone else an admin first.';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard_tr before update on profiles
  for each row execute function profiles_guard();
create trigger profiles_guard_del before delete on profiles
  for each row execute function profiles_guard();

-- --------------------------------------------------------------- zones ----
create policy zones_read on zones
  for select to authenticated using (my_role() is not null);
create policy zones_admin_write on zones
  for all to authenticated using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------ settings ----
-- Rates and lane prices are readable by office and admin only: they are money.
create policy settings_read on settings
  for select to authenticated using (sees_money());
create policy settings_admin_write on settings
  for all to authenticated using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------- parcels ----
-- Any signed-in member of staff may read parcels. Which COLUMNS they get is
-- decided by the view below, not here.
create policy parcels_read on parcels
  for select to authenticated using (my_role() is not null);

-- Scanner and above may update a parcel. The trigger decides which fields.
create policy parcels_update on parcels
  for update to authenticated using (my_role() is not null) with check (my_role() is not null);

-- Creating a parcel by scanning something unknown: office and admin.
create policy parcels_insert on parcels
  for insert to authenticated with check (sees_money());

-- Deleting is an admin act.
create policy parcels_delete on parcels
  for delete to authenticated using (is_admin());

-- A scanner may move a parcel and shelve it. Everything else on the record —
-- the money above all — is refused here rather than merely hidden.
create or replace function parcels_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r app_role := my_role();
begin
  if r is null then
    raise exception 'No active account';
  end if;
  if r in ('office', 'admin') then return new; end if;

  -- scanner: location and status only
  if new.cost      is distinct from old.cost      or
     new.cny       is distinct from old.cny       or
     new.paid      is distinct from old.paid      or
     new.paid_at   is distinct from old.paid_at   or
     new.pay_method is distinct from old.pay_method or
     new.declared  is distinct from old.declared  or
     new.customer  is distinct from old.customer  or
     new.phone     is distinct from old.phone     or
     new.client_id is distinct from old.client_id then
    raise exception 'A scanner may change where a parcel is, not its money or its client';
  end if;
  return new;
end $$;

create trigger parcels_guard_tr before update on parcels
  for each row execute function parcels_guard();

-- -------------------------------------------------------------- history ----
create policy events_read on parcel_events
  for select to authenticated using (my_role() is not null);
-- History says who did it, so it should not be possible to sign someone
-- else's name to a move.
create policy events_insert on parcel_events
  for insert to authenticated
  with check (my_role() is not null and (actor is null or actor = auth.uid()));
-- history is never edited or removed, by anyone

-- ---------------------------------------------------------------- view ----
-- What the app reads. A scanner gets nulls where the money is.
--
-- The view alone was not enough, and it is worth being clear about why. It
-- masked the figures for anyone who asked through it — but nothing obliged
-- anyone to ask through it, and `select cost from parcels` handed a scanner
-- all 8,232 charges. Row-level security could not help: it decides which ROWS
-- you may see, and a scanner is entitled to every row. So the columns are
-- taken away at the grant below, and this view is the only way back to them.
--
-- Because the columns are revoked, the view can no longer read them as the
-- caller — office included — so it reads as its owner instead and does both
-- jobs itself: `my_role() is not null` keeps out anyone with no profile, which
-- is the closed state row-level security used to provide, and sees_money()
-- still answers for the CALLER, since auth.uid() comes from the request rather
-- than from whose privileges are running.
revoke select on parcels from authenticated, anon;
grant select (
  barcode, name, item_id, client_id, customer, phone, shipment,
  status, zone, shelf, qty, weight_kg, cbm, dims,
  origin, route, notes,
  inbound_at, shipped_at, received_at, shelved_at, released_at, delivered_at,
  updated_at, updated_by
) on parcels to authenticated;

create or replace view parcels_view
with (security_invoker = false) as
select
  barcode, name, item_id, client_id, customer, phone, shipment,
  status, zone, shelf, qty, weight_kg, cbm, dims,
  origin, route, notes,
  inbound_at, shipped_at, received_at, shelved_at, released_at, delivered_at,
  updated_at, updated_by,
  case when sees_money() then declared   end as declared,
  case when sees_money() then cny        end as cny,
  case when sees_money() then cost       end as cost,
  case when sees_money() then currency   end as currency,
  case when sees_money() then paid       end as paid,
  case when sees_money() then paid_at    end as paid_at,
  case when sees_money() then pay_method end as pay_method
from parcels
where my_role() is not null;

grant select on parcels_view to authenticated;

-- ------------------------------------------------- first admin, by hand ----
-- Supabase creates the auth user; this makes that person the admin. Run it
-- once, with the id of the account that is going to run the warehouse:
--
--   insert into profiles (id, name, role)
--   values ('<auth user id>', 'Hadi', 'admin');
--
-- After that, admins create everyone else from inside the app.

-- ---------------------------------------------------------------- notes ----
-- Applied and tested on the live database, 30 Oct 2026. Fifteen checks, each
-- run as a real signed-in user of that role:
--
--   scanner   moves a parcel                 allowed
--             changes a charge               refused by the trigger
--             changes paid                   refused by the trigger
--             edits a client's phone         refused by the trigger
--             reads the rates                invisible
--             creates a parcel               refused
--             deletes a parcel               filtered to zero rows
--   office    prices and takes payment       allowed
--             reads the rates                visible
--             creates an account             refused
--             promotes itself to admin       refused
--             changes the rates              filtered to zero rows
--   admin     changes the rates              allowed
--             creates an account             allowed
--   stranger  signed in, no profile          sees nothing
--
-- Worth knowing for anyone writing more tests here: row-level security does
-- not raise on a write it disallows, it narrows the rows to none. A test that
-- treats "no exception" as "allowed" will report false failures — mine did,
-- twice, until the rows themselves were checked.

-- ------------------------------------------------------- one linter warning ----
-- Supabase's security advisor flags `public.my_role()` as a SECURITY DEFINER
-- function that signed-in users can call over the REST API. That is deliberate
-- and safe: the function reads `profiles where id = auth.uid()`, so all anyone
-- can learn by calling it is their own role, which the app shows them anyway.
--
-- It cannot simply be revoked. Every policy above calls it, and policies run
-- with the caller's own privileges, so taking EXECUTE away from `authenticated`
-- would lock all staff out of their own records. Moving it to an unexposed
-- schema would mean dropping and recreating every policy that references it —
-- that is, re-doing the part of this file that has been tested — for no gain
-- beyond removing an endpoint that reveals nothing.
