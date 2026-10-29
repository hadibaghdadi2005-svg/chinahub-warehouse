# ChinaHub warehouse control

Tools for running the China → Lebanon consolidation warehouse: a stock and
payments app, a barcode scanner for the PDA, and scripts that reconcile what is
physically on the shelves against what the ChinaHub dashboard believes.

Built because the dashboard tracks parcels but not **where they are**, and
because its Received list and the warehouse floor do not always agree.

---

## What is here

| File | What it is |
|---|---|
| `warehouse-control.html` | The warehouse app. Published as a private Claude artifact; its data lives in that artifact's shared database, not in this file. |
| `pda-scanner.html` | A standalone shelf scanner for the PDA. Opens from local storage, works offline, no network calls at all. |
| `scripts/xlsx.js` | Reader for the dashboard's `.xlsx` exports. No dependencies. |
| `scripts/scan.js` | Shared pieces: scan files, the rack layout, shelf-label checks, document ids. |
| `scripts/reconcile.js` | Compares a floor scan against an export and writes the discrepancy lists. |
| `scripts/long-stay.js` | Finds parcels that have been sitting too long, aged from the shipment code. |

**No customer data is in this repository, deliberately.** See
[Why the data is not here](#why-the-data-is-not-here).

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

In the app: **Setup → Import**, pick `reports/shelf-locations.csv`, set
*These rows are* to **Already on shelves**, and leave the zone picker alone —
each shelf code carries its own zone.

Importing an export again is safe for parcels already stored: it refreshes
names, phones, weights and charges but leaves status and shelf alone. The one
exception is a `Package location` column — if ChinaHub ever starts filling it
in, it will overwrite the locations you scanned. Check that column is empty
before importing.

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

```bash
node scripts/long-stay.js --records <dir> --days 90 --out long-stay.csv
```

`--records` is a directory of one-JSON-per-parcel records exported from the
app's database.

**Age cannot come from the app.** Every parcel's `receivedAt` is the moment the
data was imported, not when the goods arrived, so it is the same value on
thousands of records. The real date is inside the shipment code: `SH20260804…`
was raised on 4 August 2026. Parcels whose code carries no date — new arrivals
still identified by their order number — are reported separately rather than
assumed to be new.

Parcels already out for delivery or delivered are excluded.

## Charges

Charges are stored in **USD**, converted from the ￥ amount in the export at a
rate you set in the app (**Setup → ￥ per USD**, currently `6.1`). The original
￥ figure is kept on every parcel, so changing the rate and running
**Setup → Recalculate charges** rebuilds every USD figure from the yuan.

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
