#!/usr/bin/env node
/* Find parcels that have been sitting too long.
 *
 *   node scripts/long-stay.js --records <dir> [--days 90] [--out <file.csv>]
 *
 * `--records` is a directory of one-JSON-per-parcel records, as saved from the
 * app's database. Age comes from the shipment code, not from a stored date: the
 * `SH20260804234046` form carries the date the shipment was raised, and the
 * app's own receivedAt is only ever the moment the data was imported.
 *
 * Parcels already out for delivery or delivered are left out - they are gone.
 */
const fs = require("fs");
const path = require("path");
const S = require("./scan.js");

const args = {};
for(let i = 2; i < process.argv.length; i += 2)
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if(!args.records){
  console.error("usage: node scripts/long-stay.js --records <dir> [--days 90] [--out <file.csv>]");
  process.exit(1);
}
const LIMIT = Number(args.days) || 90;

const shipDate = p => {
  const m = String(p || "").match(/^[A-Z]{2}(\d{4})(\d{2})(\d{2})/);
  if(!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if(mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
};
const today = new Date();
const daysOld = d => Math.floor((today - d) / 86400000);

const dir = args.records;
const recs = [];
for(const f of fs.readdirSync(dir)){
  if(!f.endsWith(".json")) continue;
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  recs.push({ ...(j.data || j), id: f.replace(/\.json$/, "") });
}

const HERE = new Set(["received", "shelved", "expected"]);
let noDate = 0, gone = 0;
const rows = [];
for(const it of recs){
  if(!HERE.has(it.status)){ gone++; continue; }
  const d = shipDate(it.parcel);
  if(!d){ noDate++; continue; }
  const age = daysOld(d);
  if(age < LIMIT) continue;
  rows.push({ it, date: d.toISOString().slice(0, 10), age,
              cost: +it.cny ? +it.cny / 6.1 : (+it.cost || 0) });
}
rows.sort((a, b) => b.age - a.age);

const n = x => x.toLocaleString("en-US");
const m = x => "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log("records read           " + n(recs.length));
console.log("  already gone         " + n(gone) + "  (out for delivery or delivered)");
console.log("  no shipment date     " + n(noDate) + "  (shipment code carries no date)");
console.log("  still here, datable  " + n(recs.length - gone - noDate));
console.log("\nOVER " + LIMIT + " DAYS: " + n(rows.length) + " parcels");

const bucket = [[90,180,"3-6 months"],[180,270,"6-9 months"],[270,365,"9-12 months"],[365,1e9,"over a year"]];
console.log("\n  band            parcels      charged     unpaid");
for(const [lo, hi, label] of bucket){
  const b = rows.filter(r => r.age >= lo && r.age < hi);
  if(!b.length) continue;
  const c = b.reduce((s, r) => s + r.cost, 0);
  const u = b.filter(r => r.it.paid === false).reduce((s, r) => s + r.cost, 0);
  console.log("  " + label.padEnd(14) + String(b.length).padStart(7) +
    m(c).padStart(13) + m(u).padStart(11));
}
const tot = rows.reduce((s, r) => s + r.cost, 0);
const unp = rows.filter(r => r.it.paid === false).reduce((s, r) => s + r.cost, 0);
console.log("  " + "TOTAL".padEnd(14) + String(rows.length).padStart(7) +
  m(tot).padStart(13) + m(unp).padStart(11));

const byStatus = {};
rows.forEach(r => byStatus[r.it.status] = (byStatus[r.it.status] || 0) + 1);
console.log("\nby status: " + JSON.stringify(byStatus));
const onShelf = rows.filter(r => r.it.shelf).length;
console.log("with a known shelf: " + n(onShelf) + " | no location: " + n(rows.length - onShelf));

const byCl = new Map();
for(const r of rows){
  const k = String(r.it.clientId || "").trim() || "(none)";
  if(!byCl.has(k)) byCl.set(k, { n: 0, cost: 0, name: r.it.customer || "", oldest: 0 });
  const o = byCl.get(k);
  o.n++; o.cost += r.cost; if(r.age > o.oldest) o.oldest = r.age;
}
console.log("\nTOP 12 CLIENTS");
console.log("  parcels    charged  oldest  client");
[...byCl.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).forEach(([k, o]) =>
  console.log("  " + String(o.n).padStart(7) + m(o.cost).padStart(11) +
    String(o.oldest).padStart(7) + "d  " + k + "  " + o.name.slice(0, 26)));
console.log("distinct clients affected: " + byCl.size);

if(args.out){
  const header = ["barcode","shipment","shipment date","days old","status","shelf","zone",
    "client","client id","phone","charged usd","paid","weight kg","cbm","route","item"];
  fs.writeFileSync(args.out, S.toCsv(header, rows.map(r => [
    r.it.barcode, r.it.parcel, r.date, r.age, r.it.status, r.it.shelf, r.it.zone,
    r.it.customer, r.it.clientId, r.it.phone, r.cost.toFixed(2),
    r.it.paid === true ? "yes" : (r.it.paid === false ? "NO" : ""),
    r.it.weightKg, r.it.cbm, r.it.route, String(r.it.name || "").slice(0, 60),
  ])));
  console.log("\nwrote " + args.out + "  " + n(rows.length) + " rows");
}
