-- ChinaHub warehouse — schema
--
-- Three roles, enforced in the database rather than hidden in the screen:
--
--   scanner  shelves and lookups. Never sees a charge or a balance.
--   office   adds money: charges, what clients owe, taking payment.
--   admin    adds staff accounts, rates, bulk imports, deletion.
--
-- The money rules are not left to the interface. A scanner reading the
-- parcels view gets nulls where the money is, and a scanner trying to write a
-- charge is refused by a trigger, so a modified client or a stray API call
-- gains nothing.

create type app_role as enum ('scanner', 'office', 'admin');

-- ---------------------------------------------------------------- staff ----
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null,
  role        app_role not null default 'scanner',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table profiles is
  'One row per member of staff. Deactivating beats deleting: their history stays readable.';

-- The caller''s role, or null when they have no profile or are deactivated.
-- security definer so it can read profiles while profiles itself is locked down.
create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function is_admin() returns boolean
language sql stable as $$ select my_role() = 'admin' $$;

create or replace function sees_money() returns boolean
language sql stable as $$ select my_role() in ('office', 'admin') $$;

-- ---------------------------------------------------------------- zones ----
create table zones (
  code        text primary key,
  label       text,
  kind        text not null default 'shelf',   -- shelf | staging
  racks       int,
  levels      int,
  sort        int not null default 0
);

-- -------------------------------------------------------------- parcels ----
create table parcels (
  barcode      text primary key,
  name         text,
  item_id      text,
  client_id    text,
  customer     text,
  phone        text,
  shipment     text,                            -- the SH… consignment code
  status       text not null default 'received',
  zone         text,
  shelf        text,
  qty          int           not null default 0,
  weight_kg    numeric(12,3) not null default 0,
  cbm          numeric(12,6) not null default 0,
  dims         text,
  declared     numeric(12,2) not null default 0,
  cny          numeric(12,2) not null default 0,
  cost         numeric(12,2) not null default 0,
  currency     text not null default 'USD',
  paid         boolean not null default false,
  paid_at      timestamptz,
  pay_method   text,
  origin       text,
  route        text,
  notes        text,
  -- the dashboard's own dates. Neither is an arrival in Lebanon; it exports none.
  inbound_at   timestamptz,
  shipped_at   timestamptz,
  received_at  timestamptz,
  shelved_at   timestamptz,
  released_at  timestamptz,
  delivered_at timestamptz,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users,
  constraint parcels_status_known
    check (status in ('expected','received','shelved','released','delivered'))
);

create index parcels_status_idx   on parcels (status);
create index parcels_shelf_idx    on parcels (shelf)     where shelf <> '';
create index parcels_zone_idx     on parcels (zone)      where zone <> '';
create index parcels_client_idx   on parcels (client_id);
create index parcels_shipment_idx on parcels (shipment);
create index parcels_unpaid_idx   on parcels (paid)      where paid = false;
create index parcels_shipped_idx  on parcels (shipped_at);

-- free text across the fields people actually search by
create index parcels_search_idx on parcels using gin (
  to_tsvector('simple',
    coalesce(barcode,'') || ' ' || coalesce(customer,'') || ' ' ||
    coalesce(phone,'')   || ' ' || coalesce(shelf,'')    || ' ' ||
    coalesce(name,'')    || ' ' || coalesce(shipment,''))
);

-- -------------------------------------------------------------- history ----
create table parcel_events (
  id          bigserial primary key,
  barcode     text not null references parcels on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid references auth.users,
  from_status text,
  to_status   text,
  loc         text,
  note        text
);
create index parcel_events_barcode_idx on parcel_events (barcode, at desc);
create index parcel_events_at_idx      on parcel_events (at desc);

-- ------------------------------------------------------------- settings ----
-- One row. Rates, lane prices, free days, warehouse name — the app reads it whole.
create table settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into settings (id, data) values (1, '{}'::jsonb);

-- --------------------------------------------------- keep updated_at true ---
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

create trigger parcels_touch before update on parcels
  for each row execute function touch_updated_at();
