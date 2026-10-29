#!/usr/bin/env node
/* Compare a floor scan against a ChinaHub Received export.
 *
 *   node scripts/reconcile.js --scans <dir|file.csv> --export <file.xlsx> [--out <dir>]
 *
 * Prints a summary and, with --out, writes four lists:
 *
 *   shelf-locations.csv        scanned parcels the export knows about (import these)
 *   not-in-system.csv          on your shelves, absent from the export
 *   not-on-shelf.csv           in the export, found on no shelf
 *   shelf-problems.csv         scans whose shelf label did not read properly
 *
 * The export's own column names move around between report types, so the order
 * number column is found by name with a few known spellings.
 */

const fs = require("fs");
const path = require("path");
const X = require("./xlsx");
const S = require("./scan");

/* ------------------------------ arguments ------------------------------ */
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, "");
  args[k] = process.argv[i + 1];
}
if (!args.scans || !args.export) {
  console.error("usage: node scripts/reconcile.js --scans <dir> --export <file.xlsx> [--out <dir>]");
  process.exit(1);
}

/* ------------------------------ the export ------------------------------
 * Both report types seen so far put the order number in sheet 1. The billing
 * style calls it "order number"; keep adding spellings here as they appear.
 */
const ORDER_KEYS = ["order number", "Order number", "订单号", "ordernumber", "Order Number"];
const records = X.readRecords(args.export, 1);
if (!records.length) { console.error("no rows in sheet 1 of " + args.export); process.exit(1); }

const key = ORDER_KEYS.find(k => k in records[0]);
if (!key) {
  console.error("could not find an order-number column. Columns are:\n  " +
    Object.keys(records[0]).join("\n  "));
  process.exit(1);
}
const byOrder = new Map();
for (const r of records) {
  const id = String(r[key] || "").trim();
  if (id && !byOrder.has(id)) byOrder.set(id, r);
}

/* ------------------------------- the scan ------------------------------- */
const scans = S.readScans(args.scans);

const seen = new Map();          // barcode -> rows
for (const r of scans) {
  if (!seen.has(r.barcode)) seen.set(r.barcode, []);
  seen.get(r.barcode).push(r);
}

const repeats = [...seen.entries()].filter(([, l]) => l.length > 1);
const moved = repeats.filter(([, l]) => new Set(l.map(r => r.shelf)).size > 1);

const problems = [], good = [];
for (const r of scans) {
  const t = S.tidyShelf(r.shelf);
  const why = S.shelfProblem(t.shelf);
  if (why) problems.push({ ...r, why });
  else good.push({ ...r, shelf: t.shelf, note: t.note });
}

const matched = good.filter(r => byOrder.has(r.barcode));
const unknown = good.filter(r => !byOrder.has(r.barcode));
const scannedSet = new Set(scans.map(r => r.barcode));
const notFound = [...byOrder.keys()].filter(b => !scannedSet.has(b));

/* ------------------------------- locations ------------------------------- */
const used = new Set(good.map(r => r.shelf));
const empties = {};
for (const z of Object.keys(S.ZONES)) {
  let n = 0;
  for (let rack = 1; rack <= S.ZONES[z]; rack++)
    for (let lvl = 1; lvl <= S.LEVELS; lvl++) {
      const forms = [
        z + rack + "-01-0" + lvl,
        z + String(rack).padStart(2, "0") + "-01-0" + lvl,
        z + "-" + String(rack).padStart(2, "0") + "-0" + lvl,
      ];
      if (!forms.some(f => used.has(f))) n++;
    }
  empties[z] = n;
}

/* -------------------------------- output -------------------------------- */
const n = x => x.toLocaleString("en-US");
console.log("SCAN");
console.log("  scans            " + n(scans.length) + " across " +
  new Set(scans.map(r => r.file)).size + " file(s)");
console.log("  unique parcels   " + n(seen.size));
console.log("  scanned twice    " + repeats.length +
  (moved.length ? "  (" + moved.length + " on two different shelves - check these)" : ""));
console.log("  bad shelf labels " + problems.length);
console.log("  locations used   " + used.size);
for (const z of Object.keys(S.ZONES))
  console.log("    zone " + z + ": " + (S.ZONES[z] * S.LEVELS - empties[z]) +
    " of " + S.ZONES[z] * S.LEVELS + " holding parcels");

console.log("\nAGAINST THE EXPORT (" + n(byOrder.size) + " parcels)");
console.log("  found on a shelf     " + n(matched.length));
console.log("  on a shelf, not listed " + n(unknown.length));
console.log("  listed, never found  " + n(notFound.length));

if (moved.length) {
  console.log("\nSAME PARCEL ON TWO SHELVES");
  for (const [bc, l] of moved.slice(0, 20))
    console.log("  " + bc + "  " + l.map(r => r.shelf + " (" + r.file + ":" + r.line + ")").join("  "));
}
if (problems.length) {
  console.log("\nSHELF LABELS THAT DID NOT READ");
  const grouped = {};
  for (const p of problems) {
    const k = p.shelf + " :: " + p.why;
    grouped[k] = (grouped[k] || 0) + 1;
  }
  for (const k of Object.keys(grouped))
    console.log("  " + String(grouped[k]).padStart(4) + " parcels  " + k);
  console.log("  -> the scan order tells you which shelf these belong to:" +
    " look at what was scanned either side of them in shelf-problems.csv");
}

if (!args.out) {
  console.log("\n(pass --out <dir> to write the four lists)");
  process.exit(0);
}

fs.mkdirSync(args.out, { recursive: true });
const write = (name, header, rows) => {
  fs.writeFileSync(path.join(args.out, name), S.toCsv(header, rows));
  console.log("  " + name + "  " + n(rows.length) + " rows");
};
console.log("\nWROTE to " + args.out);
write("shelf-locations.csv", ["barcode", "shelf"], matched.map(r => [r.barcode, r.shelf]));
write("not-in-system.csv", ["barcode", "shelf", "zone", "scanned at"],
  unknown.map(r => [r.barcode, r.shelf, r.shelf[0], r.at]));
write("shelf-problems.csv", ["barcode", "scanned as", "why", "file", "line", "scanned at"],
  problems.map(r => [r.barcode, r.shelf, r.why, r.file, r.line, r.at]));

/* carry through whatever the export happens to give us about the missing ones */
const pick = (r, names) => { for (const k of names) if (r[k]) return r[k]; return ""; };
write("not-on-shelf.csv",
  ["barcode", "client id", "client", "phone", "declared", "weight kg", "route"],
  notFound.map(b => {
    const r = byOrder.get(b);
    return [b,
      pick(r, ["clientID", "客户ID", "client id"]),
      pick(r, ["Username", "用户名"]),
      pick(r, ["Mobile/Phone", "手机号"]),
      pick(r, ["Total declared value (￥)", "Package declared value"]),
      pick(r, ["Inbound actual weight (KG)", "Package weight (KG)"]),
      pick(r, ["Route name", "路线名称"])];
  }));
