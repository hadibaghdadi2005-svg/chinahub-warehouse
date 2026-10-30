# ChinaHub warehouse control

Tools for running the China → Lebanon consolidation warehouse: a staff app with
sign-in, a barcode scanner for the PDA, and scripts that reconcile what is
physically on the shelves against what the ChinaHub dashboard believes.

Built because the dashboard tracks parcels but not **where they are**, and
because its Received list and the warehouse floor do not always agree.

---

## The app

**https://hadibaghdadi2005-svg.github.io/chinahub-warehouse-app/**

Open it on a PC or a PDA and install it from the browser. It signs in against
a Postgres database holding 8,232 parcels and their history, and what each
person can see and do is decided there, not on screen.

| Role | Can |
|---|---|
| scanner | Scan, shelve, look up. **Never sees a charge** — the money columns are revoked, not hidden. |
| office | All of that, plus pricing, taking payment and bringing exports in. |
| admin | All of that, plus staff accounts, rates and the floor plan. |

Six tabs: **Scan** (five modes, shelf labels, range checks, sound, undo),
**Stock** (tiles, filters, search, paging), **Zones**, **Money**, **Setup**
(rates, lane prices, floor plan, import) and **Staff**.

Accounts are made by an admin from inside the app; there is no public sign-up.

---

## What is here

| File | What it is |
|---|---|
| `app/index.html` | The app. Published to GitHub Pages by `app/publish-pages.js`, which regenerates the public repo — never edit that copy by hand. |
| `app/sw.js`, `manifest.webmanifest`, `icon-*.png` | What makes it installable and able to open with no network. Icons are drawn by `app/make-icons.js`. |
| `app/serve.js` | A local server for trying the app before publishing. |
| `app/test-render.js` | Builds every view headlessly. A view that throws reaches a PDA as a blank screen and nothing else catches it. |
| `app/test-scan-logic.js` | The barcode and shelf-label rules, against the real zone layout. |
| `app/test-import.js` | Runs the importer over a real dashboard export. |
| `server/01_schema.sql` | Tables, indexes, the status constraint. |
| `server/02_security.sql` | Who may see and do what. Read this before changing any of it. |
| `server/03_migration.md` | How the records came out of the Claude artifact, and how that was checked. |
| `server/functions/staff/` | Creating a sign-in needs the service key, so it happens here, not in the app. |
| `warehouse-control.html` | The original Claude artifact. Still works; the app above replaces it. |
| `pda-scanner.html` | A standalone offline shelf scanner. No network calls at all. |
| `scripts/xlsx.js` | Reader for the dashboard's `.xlsx` exports. No dependencies. |
| `scripts/scan.js` | Shared pieces: scan files, the rack layout, shelf-label checks, document ids. |
| `scripts/reconcile.js` | Compares a floor scan against an export and writes the discrepancy lists. |
| `scripts/long-stay.js` | Finds parcels that have been sitting too long, aged from the shipment code. |

**No customer data is in this repository, deliberately.** See
[Why the data is not here](#why-the-data-is-not-here). The public Pages repo
holds the page and its icons only, and is checked before each publish.

---

## The warehouse

Four zones, five levels per rack, **level 01 at the top**.

| Zone | Racks | Locations |
|---|---|---|
| A | 10 | 50 |
| B | 24 | 120 |
| C | 22 | 110 |
| D | 8 | 40 |
| | | **320** |

### Shelf labels come in two forms

Both are in use on the physical shelves and both are valid:

```
ZONE+RACK-01-LEVEL     A1-01-03   B17-01-04   C10-01-02   D01-01-05
ZONE-RACK-LEVEL        C-01-03    D-07-04
```

The second form is used by **zone C racks 1–9** and **zone D racks 7–8**. The
middle segment of the first form is always `01`. They are told apart by whether
the first segment carries digits, so nothing is ambiguous — but if you ever
reprint labels, standardise on the first form.

`scripts/scan.js` understands both, and treats `C10-0-2` as a typo for
`C10-01-02` since the middle segment can only ever be `01`.

---

## The routine

### 1. Scan the shelves

Open `pda-scanner.html` on the PDA. Scan a **shelf label**, then every parcel on
that shelf, then the next shelf label. It beeps differently for a shelf, a
parcel, a repeat, and a parcel scanned before any shelf.

Scans are held in the PDA's local storage and survive closing the app. **Export
after each zone** — one file per zone is the easiest thing to work with. The
export is `barcode,shelf,scanned at`.

### 2. Pull a fresh export

From the dashboard's Received list. Get **every** row, not the first page — the
page size selector has to be raised before exporting or you get 100 rows.

Two report types have appeared so far, with different columns:

- a **billing** export, with `Actual payment amount` (the ￥ charge),
  payment method and a paid-at date
- a **manifest** export, with declared values, weights and sizes but **no
  charge and no payment status**

Only the billing one can be used to invoice. Both can be used to tell which
parcels are still listed as Received.

### 3. Reconcile

```bash
node scripts/reconcile.js --scans . --export "EXPORT.xlsx" --out reports
```

`--scans` takes a directory (every scanner file in it is read) or a single file.
It identifies scanner output by its exact header, so pointing it at a folder
that also holds reports is safe.

You get four lists in `reports/`:

| List | Meaning |
|---|---|
| `shelf-locations.csv` | Scanned parcels the export knows about. **Import these** to record locations. |
| `not-in-system.csv` | On your shelves, absent from the export. Either the dashboard is behind, or it has lost them. |
| `not-on-shelf.csv` | Listed as Received, found on no shelf. The list that matters. |
| `shelf-problems.csv` | Scans whose shelf label did not read. Recoverable from the scan order — see below. |

### 4. Import the locations

In the app: **Setup → Bring a list in**, pick the file, and set *New parcels
arrive as* for anything the warehouse has not seen before.

Importing an export again is safe for parcels already stored. A value only
overwrites when the export actually carries one, so a partial export cannot
blank a weight or a phone number, and **status, zone and shelf are set on a new
parcel only** — a parcel already on C22-01-05 keeps its shelf whatever the file
says.

The dashboard's `Package location` column is **never mapped by default**, and
the app says why if you map it anyway: it is where the parcel sat in China, and
it is what forced the floor re-scan in the first place.

The preview also names any column that is mapped but **blank in every row** — a
column can be ticked in the dashboard and exported empty, which looks exactly
like a good import until someone needs the figure.

---

## Reading the results

### A shelf label that did not read

The scan order recovers it. If twelve parcels were scanned between `C17-01-03`
and `C17-01-05`, they are on `C17-01-04`. Check the shelf before trusting it,
then fix the physical label.

### Parcels on a shelf that the dashboard does not list

The dashboard runs roughly **a day behind on intake**. On 29 October, 48 of 166
such parcels turned up in the next day's export on their own. So compare again a
few days later before treating any of them as genuinely missing.

### Parcels listed as Received that are on no shelf

Check two things before concluding anything is lost:

1. **Is it one account?** On 29 October, 1,184 of 1,961 belonged to a single
   forwarder account with 405 different end-recipient phone numbers. One account
   dominating means a storage area, not scattered loss.
2. **Did they ship?** A parcel that has left shows up as *absent from the next
   export*, not as a status change. Comparing two exports a day apart found 120
   departures — only 6% of the gap.

### Parcels on a shelf that vanished from the export

These are the ones worth chasing. If the rest of that client's consignment
shipped and one parcel is still on your shelf, it was **left behind during
picking** and the dashboard thinks it went. Two cases turned up on 29 October,
one of them on the shelf since August.

Nothing in the dashboard catches this. Only a scan does.

---

## Finding parcels that have sat too long

The app has this built in: the **Here too long** tile on the Stock tab, and
*Here over 90 days* in the payment filter. The threshold is
**Setup → “Here too long” after (days)**.

For a one-off report, or to try several thresholds at once:

```bash
node scripts/long-stay.js --records <dir> --days 90 --out long-stay.csv
```

`--records` is a directory of one-JSON-per-parcel records exported from the
app's database.

**Age cannot come from `received_at`.** It is the moment the data was imported,
not when the goods arrived, so it is the same value on thousands of records.
The app counts from **when the parcel left China** (`shipped_at`, which the
export does carry) and falls back to when it was first recorded here, and the
parcel screen says which of the two it used. The older `long-stay.js` reads the
date out of the shipment code instead: `SH20260804…` was raised on 4 August
2026.

Parcels already out for delivery or delivered are excluded.

## Charges

Charges are stored in **USD**, converted from the ￥ amount in the export at a
rate set in **Setup → Yuan per 1 USD** (currently `6.1`). The original ￥ figure
is kept on every parcel, so the conversion can always be re-checked.

Freight is priced per lane, in **Setup → Price per lane**. A parcel is matched
on what its route says and the most specific match wins, so `Air Cargo Hk`
beats `Air Cargo` whatever order they are in. **Count what each lane takes**
runs the match over every parcel so a mistyped lane is visible — on 30 October:
Guangzhou 4,535, sea 2,208, Hong Kong 854, air-other 451, and 184 matching no
lane at all. A lane priced 0 is ignored and the fallback rate is used.

Note that the dashboard's chargeable column means CBM on sea routes and
kilograms on air, so it cannot be read as a single unit. Volume is derived from
the box dimensions instead.

---

## Why the data is not here

`.gitignore` excludes every `.csv`, `.xlsx`, the `bundle/` and `seed/` folders,
and anything the scripts write.

Those files hold names, mobile numbers, client IDs, declared values, charges and
payment status for thousands of ChinaHub customers. A private repository is one
mis-click from being public, and accounts get compromised. The downside is not
"my files leaked" — it is a published list of customers with phone numbers and
what they owe. The code is worth versioning; the customer list is not worth the
risk.

The schema and the customer data are also arguably ChinaHub's rather than
personal, which is a second reason to keep them out.

---

## Things learned the hard way

- **The order number is the parcel number.** They are the same field; the `SH…`
  code is the *shipment* it travels in, and several parcels share one.
- **`Outbound volume (m³)` is empty** on every row of the exports seen so far.
  Derive volume from the dimension columns.
- **Phone numbers are inconsistent**: `0961-70106299`, `-76 499 864`,
  `+96170609841`. A leading dash means the country code was dropped.
- **One order can span several rows.** Multi-package orders repeat the
  per-package columns and leave the order columns blank on the extra rows, so
  counting rows overcounts orders. On 29 October: 3,500 rows, 3,483 orders.
- **The top shelves are nearly empty.** Of 1,737 parcels, level 01 held 107 and
  level 04 held 641. Expected, but worth knowing before reading a level count as
  a problem.
- **Hiding a figure is not protecting it.** The money was masked in a view, and
  `select cost from parcels` still handed a scanner all 8,232 charges. Row-level
  security could not have caught it — it governs which *rows* you see, and a
  scanner is entitled to every row. Columns have to be revoked. See
  `server/02_security.sql`.
- **A disallowed write does not fail, it changes nothing.** Postgres narrows it
  to zero rows. Any check that treats "no error" as "it worked" will report
  success for a write that never happened — read the rows back.

---

## Still on the warehouse floor

Not software, and not done:

- **1,854 shelf locations** in `shelf-worksheet.csv` never loaded.
- **480 parcels** left China more than 90 days ago and are still in transit.
- **1,884 parcels** with no location, 1,184 of them on account `1000001`.
- **16 parcels** on the two shelf labels that would not read.
- **4 + 7 picking misses** — shipped on paper, still on the shelf.
- **18 parcels with no charge at all**, 17 of them on client `65`.
- **Three mangled barcodes** that came in that way from ChinaHub and are real
  parcels with real customers: `YT`, `test435453534`, `Test398329829`.
