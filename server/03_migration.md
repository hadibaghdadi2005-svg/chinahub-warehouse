# Moving the records out of the Claude artifact

Done 30 October 2026. The warehouse app had been running on the artifact's own
database; this is the record of getting that data into Postgres so the
installable app can take over.

## What moved

| | rows |
|---|---|
| parcels | 8,232 |
| parcel history | 22,918 |
| zones | 7 |
| settings | 1 (rates, lane prices, free days, long-stay threshold) |

The artifact kept four stores, not one — `items`, `zones`, `meta/settings` and
`meta/feed`. The first three moved. `meta/feed` is the in-app activity strip,
rebuilt from the history on each load, so it was read and left behind.

## How

`ArtifactData` was paged 1,000 records at a time into one JSON file per parcel
under `reports/final/items-raw/`. At four points during the dump every id that
came back was checked against the ids already on disk: nothing new appeared, so
the record set had not shifted underneath the dump. 8,232 files landed for a
live count of 8,232.

Getting them into Postgres then had to get past a real constraint: the only
channel to the database is a SQL tool, and writing 3.3 MB of INSERT statements
by hand is both slow and the kind of job where a dropped row goes unnoticed.
`COPY FROM` is not available (the database cannot read local files), and
nothing on this machine speaks Postgres directly — no `psql`, no `pg` module.

So the data was sent over HTTPS instead, by `push-to-supabase.js`:

1. Two staging tables and two `_load_*(jsonb)` functions were created, granted
   to `anon`, each writing **only** to staging.
2. The script read the dump and POSTed it to `/rest/v1/rpc/_load_*` in chunks
   of 1,000 parcels and 2,000 events, using the project's publishable key.
3. One `INSERT … SELECT` promoted staging into `parcels` and `parcel_events`,
   with the `updated_at` trigger held off so the dump's own timestamps
   survived, and `0` timestamps becoming null rather than 1 Jan 1970.
4. The loaders and staging tables were dropped and the grants revoked. Nothing
   of the scaffolding is left — checked, not assumed.

The rows went from this machine to the database without passing through the
conversation, so there was nothing to mistype.

## How it was checked

Thirty-three figures were computed from the files on disk and from the loaded
tables independently and compared: row counts, the five status counts, sums of
charge, CNY, declared value, weight, volume and quantity, paid count and value,
how many rows carry a shelf, a zone and each of the seven dates, distinct
routes, origins, payment methods and clients, and the earliest and latest
shipping date. All thirty-three agree.

One apparent mismatch was the comparison's fault, not the migration's: the
local check treated a phone number of `"0"` as empty. Two parcels
(`DPK300000000001`, `SF5100000000001`) really do carry `"0"` as their phone in
ChinaHub's data. The database's 8,205 is the right answer.

Aggregates can agree while individual rows are wrong, so every field of every
row was then checksummed on both sides — one pipe-separated line per row,
numbers at fixed decimals, dates as whole epoch seconds, sorted and hashed:

```
parcels   8232   ff260d208f902c9018863f3186d98f08
events   22918   d48b5e5aa611ddfca2a32cf61ea168fb
```

Both match. The first attempt did not, which was worth chasing down: Postgres
sorted the lines by the database collation while `checksum-dump.js` sorted them
by raw bytes. `order by line collate "C"` settled it. The data was never in
question — but a checksum you cannot explain is not a check.

Money masking was re-tested against the real rows rather than taken on trust
from the empty-table tests. Read with no profile, `parcels_view` returns all
8,232 rows with every barcode and all 1,633 shelf locations, and null for
`cost`, `cny`, `declared`, `paid_at` and `pay_method` — while the table behind
it holds all 8,232 charges.

## The first admin

Everything turns on `my_role()`, and an empty `profiles` gives everyone no
role — so until there is one admin, **nobody can read anything through the
app**. That is the correct closed state, not a fault.

The account itself has to be made in the Supabase dashboard, by hand, because
the password should be chosen by the person it belongs to and nobody else:

> Authentication → Users → Add user → `hadibaghdadi11@gmail.com`, a password
> of his own, **Auto Confirm User** switched on.

The profile attaches itself. `bootstrap_first_admin_tr` on `auth.users` is a
one-shot trigger that gives that one address an admin profile — but only while
`profiles` is completely empty, so the moment it fires it can never fire again,
and a stranger signing up first gets nothing. Checked both ways round before
it was armed, with the test rolled back.

**Drop it once he has signed in:**

```sql
drop trigger if exists bootstrap_first_admin_tr on auth.users;
drop function if exists bootstrap_first_admin();
```

It is inert after the first profile exists, but a trigger with an email address
baked into it is not something to leave lying around in a year's time.

## Still to do

Nothing is hosted. The app runs from `app/` on a local server; the staff need
a URL before any of them can install it.

**Not Supabase Storage.** This was tried on 30 October and does not work.
Storage serves uploaded HTML as `text/plain` no matter what content type it
was uploaded with — Supabase does this on purpose, so that nobody can host a
convincing page on a `supabase.co` URL. The manifest, the service worker and
the icons all came back with the right types; only the page itself is
rewritten, and a browser shows it as source. There is no way round it from the
upload side. The bucket and its files were removed again.

Whatever hosts this needs to be a plain static host that serves `text/html`:
GitHub Pages, Cloudflare Pages, Netlify and the like all do.
