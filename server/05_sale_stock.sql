-- Sale stock: parcels clients did not want, sold by the kilo.
--
-- A parcel scanned into sale stock becomes status 'for_sale' (its old status
-- and place are kept on the sale item, so it can be put back). The sale item
-- carries an English name, a photo, the weight, a category with a $/kg rate,
-- and later the sale.

alter table parcels drop constraint if exists parcels_status_known;
alter table parcels add constraint parcels_status_known check (status = any (array[
  'expected', 'received', 'shelved', 'at_branch', 'released', 'delivered', 'for_sale']));

create table if not exists sale_categories (
  id          serial primary key,
  name        text not null unique,
  rate_per_kg numeric(10,2) not null default 0 check (rate_per_kg >= 0),
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
alter table sale_categories enable row level security;
create policy sale_cat_read on sale_categories for select to authenticated using (sees_money());
create policy sale_cat_write on sale_categories for all to authenticated using (sees_money()) with check (sees_money());

create table if not exists sale_items (
  id             bigserial primary key,
  barcode        text not null unique references parcels(barcode) on update cascade,
  name_cn        text,
  name_en        text,
  category_id    int references sale_categories(id) on delete set null,
  weight_kg      numeric(10,3) not null default 0 check (weight_kg >= 0),
  price_override numeric(10,2) check (price_override >= 0),
  photo_path     text,
  spot           text,
  note           text,
  status         text not null default 'in_stock' check (status in ('in_stock', 'sold')),
  client_id      text,
  customer       text,
  prev_status    text,
  prev_zone      text,
  prev_shelf     text,
  added_at       timestamptz not null default now(),
  added_by       uuid default auth.uid(),
  sold_at        timestamptz,
  sold_price     numeric(10,2),
  sold_by        uuid,
  updated_at     timestamptz not null default now()
);
alter table sale_items enable row level security;
create policy sale_items_read on sale_items for select to authenticated using (sees_money());
-- Editing name, photo, weight, category, price, spot, note: office and admin.
-- Adding, putting back and selling go through the functions below.
create policy sale_items_update on sale_items for update to authenticated using (sees_money()) with check (sees_money());
create index if not exists sale_items_status on sale_items (status, added_at desc);

create or replace function sale_items_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists sale_items_touch on sale_items;
create trigger sale_items_touch before update on sale_items for each row execute function sale_items_touch();

-- Scan a parcel into sale stock.
create or replace function sale_add(p_barcode text) returns sale_items
language plpgsql security definer set search_path = public as $$
declare p parcels; s sale_items; bc text := btrim(coalesce(p_barcode, ''));
begin
  if not sees_money() then raise exception 'Only the office may add to sale stock'; end if;
  select * into p from parcels where barcode = bc for update;
  if not found then raise exception 'No parcel with the number %', bc; end if;
  select * into s from sale_items where barcode = bc;
  if found then raise exception 'ALREADY:%', s.id; end if;
  if p.status not in ('received', 'shelved', 'expected') then
    raise exception 'This parcel is not in the warehouse (it is %). Put it back first if it really is here.',
      case p.status when 'delivered' then 'delivered' when 'released' then 'with Waseet'
                    when 'at_branch' then 'at Hamra' else p.status end;
  end if;
  insert into sale_items (barcode, name_cn, weight_kg, client_id, customer, prev_status, prev_zone, prev_shelf)
  values (bc, p.name, coalesce(p.weight_kg, 0), p.client_id, p.customer, p.status, p.zone, p.shelf)
  returning * into s;
  update parcels set status = 'for_sale', received_at = coalesce(received_at, now()),
         updated_at = now(), updated_by = auth.uid()
   where barcode = bc;
  insert into parcel_events (barcode, at, actor, from_status, to_status, loc, note)
  values (bc, now(), auth.uid(), p.status, 'for_sale', null, 'moved to sale stock');
  return s;
end $$;

-- Take an item out of sale stock and put the parcel back as it was.
create or replace function sale_undo(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare s sale_items;
begin
  if not sees_money() then raise exception 'Only the office may change sale stock'; end if;
  select * into s from sale_items where id = p_id for update;
  if not found then raise exception 'That item is not in sale stock'; end if;
  if s.status = 'sold' then raise exception 'It is sold. Undo the sale first.'; end if;
  update parcels set status = coalesce(s.prev_status, 'received'), zone = s.prev_zone, shelf = s.prev_shelf,
         updated_at = now(), updated_by = auth.uid()
   where barcode = s.barcode and status = 'for_sale';
  insert into parcel_events (barcode, at, actor, from_status, to_status, loc, note)
  values (s.barcode, now(), auth.uid(), 'for_sale', coalesce(s.prev_status, 'received'),
          coalesce(s.prev_shelf, s.prev_zone), 'taken out of sale stock');
  delete from sale_items where id = p_id;
  return s.photo_path;
end $$;

-- Sell (p_price not null) or undo a sale (p_price null).
create or replace function sale_sell(p_id bigint, p_price numeric) returns sale_items
language plpgsql security definer set search_path = public as $$
declare s sale_items;
begin
  if not sees_money() then raise exception 'Only the office may sell'; end if;
  if p_price is not null and p_price < 0 then raise exception 'A price cannot be negative'; end if;
  update sale_items set
    status = case when p_price is null then 'in_stock' else 'sold' end,
    sold_price = p_price,
    sold_at = case when p_price is null then null else now() end,
    sold_by = case when p_price is null then null else auth.uid() end
  where id = p_id returning * into s;
  if not found then raise exception 'That item is not in sale stock'; end if;
  return s;
end $$;

grant execute on function sale_add(text), sale_undo(bigint), sale_sell(bigint, numeric) to authenticated;

-- Photos: a public bucket (product pictures only, ready for a shop page);
-- only the office uploads or deletes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sale-photos', 'sale-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy sale_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sale-photos' and public.sees_money());
create policy sale_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'sale-photos' and public.sees_money());
create policy sale_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sale-photos' and public.sees_money());
-- Deleting (and replacing) a photo looks it up first, so it needs a read rule
-- too. The pictures are public by link anyway.
create policy sale_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'sale-photos' and public.sees_money());

-- Floor scans and bulk moves leave sale stock alone: a parcel for sale only
-- leaves sale stock through sale_undo.
do $patch$
declare d text; n text;
begin
  d := pg_get_functiondef('shelve_from_scan(jsonb)'::regprocedure);
  n := replace(d, $a$where k.was_shelf is distinct from k.shelf or k.was_status is distinct from 'shelved'$a$,
                  $a$where k.was_status is distinct from 'for_sale'
      and (k.was_shelf is distinct from k.shelf or k.was_status is distinct from 'shelved')$a$);
  if n = d then raise exception 'shelve_from_scan: pattern not found'; end if;
  execute n;

  d := pg_get_functiondef('bulk_move(text[],text,text,text)'::regprocedure);
  n := replace(d, $a$where pa.barcode = any(p_barcodes)
      and (pa.status is distinct from p_to$a$,
                  $a$where pa.barcode = any(p_barcodes) and pa.status <> 'for_sale'
      and (pa.status is distinct from p_to$a$);
  if n = d then raise exception 'bulk_move: pattern not found'; end if;
  execute n;
end $patch$;

-- Many at once, from the PDA scanner's export (barcode, shelf, scanned at).
-- Each row is tried on its own: one bad barcode does not stop the rest. The
-- shelf the PDA scanned first (e.g. SALE-01) becomes the item's "kept at".
create or replace function sale_add_many(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  added text[] := '{}'; already text[] := '{}'; unknown text[] := '{}';
  refused jsonb := '[]'::jsonb;
begin
  if not sees_money() then raise exception 'Only the office may add to sale stock'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then
    raise exception 'Too many at once. Import at most 2,000 parcels per file.';
  end if;
  for r in
    select distinct on (bc) bc, sh from (
      select btrim(x.barcode) bc, nullif(upper(btrim(coalesce(x.shelf, ''))), '') sh
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) x(barcode text, shelf text)) t
    where bc <> '' order by bc
  loop
    begin
      perform sale_add(r.bc);
      if r.sh is not null then update sale_items set spot = r.sh where barcode = r.bc; end if;
      added := added || r.bc;
    exception when others then
      if sqlerrm like 'ALREADY:%' then already := already || r.bc;
      elsif sqlerrm like 'No parcel%' then unknown := unknown || r.bc;
      else refused := refused || jsonb_build_object('barcode', r.bc, 'why', sqlerrm);
      end if;
    end;
  end loop;
  return jsonb_build_object('added', to_jsonb(added), 'already', to_jsonb(already),
                            'unknown', to_jsonb(unknown), 'refused', refused);
end $$;
grant execute on function sale_add_many(jsonb) to authenticated;

-- Later: sale_add_many can also add numbers the app has never seen (old
-- parcels from before any export was loaded). They become bare parcels with
-- no name, client or weight, then go into sale stock like the rest.
drop function if exists sale_add_many(jsonb);
create or replace function sale_add_many(p_rows jsonb, p_create_unknown boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  added text[] := '{}'; already text[] := '{}'; unknown text[] := '{}'; created text[] := '{}';
  refused jsonb := '[]'::jsonb;
begin
  if not sees_money() then raise exception 'Only the office may add to sale stock'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then
    raise exception 'Too many at once. Import at most 2,000 parcels per file.';
  end if;
  for r in
    select distinct on (bc) bc, sh from (
      select btrim(x.barcode) bc, nullif(upper(btrim(coalesce(x.shelf, ''))), '') sh
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) x(barcode text, shelf text)) t
    where bc <> '' order by bc
  loop
    begin
      if p_create_unknown and not exists (select 1 from parcels where barcode = r.bc) then
        insert into parcels (barcode, status, received_at, updated_at, updated_by, notes)
        values (r.bc, 'received', now(), now(), auth.uid(), 'Added for sale stock: not in any export');
        insert into parcel_events (barcode, at, actor, from_status, to_status, loc, note)
        values (r.bc, now(), auth.uid(), null, 'received', null, 'added for sale stock, not in any export');
        created := created || r.bc;
      end if;
      perform sale_add(r.bc);
      if r.sh is not null then update sale_items set spot = r.sh where barcode = r.bc; end if;
      added := added || r.bc;
    exception when others then
      if sqlerrm like 'ALREADY:%' then already := already || r.bc;
      elsif sqlerrm like 'No parcel%' then unknown := unknown || r.bc;
      else refused := refused || jsonb_build_object('barcode', r.bc, 'why', sqlerrm);
      end if;
    end;
  end loop;
  return jsonb_build_object('added', to_jsonb(added), 'already', to_jsonb(already),
                            'unknown', to_jsonb(unknown), 'created', to_jsonb(created), 'refused', refused);
end $$;
grant execute on function sale_add_many(jsonb, boolean) to authenticated;

-- Quantity (pieces) per sale item, copied from the parcel when it is added
-- and editable after. sale_add copies it from now on.
alter table sale_items add column if not exists qty int check (qty is null or qty >= 0);
update sale_items s set qty = nullif(p.qty, 0) from parcels p where p.barcode = s.barcode and s.qty is null;
-- (sale_add re-created with qty: insert ... qty = nullif(p.qty, 0) ...; see the live function.)
