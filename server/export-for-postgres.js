#!/usr/bin/env node
/* Turn a dump of the Claude artifact's records into something Postgres can load.
 *
 *   node server/export-for-postgres.js --records <dir> --out server/data
 *
 * Writes parcels.csv, parcel_events.csv and zones.csv, with column names and
 * ordering matching 01_schema.sql, ready for \copy or the Supabase importer.
 *
 * Dates go out as ISO timestamps; a 0 becomes empty, which Postgres reads as
 * null rather than 1970.
 */

const fs = require("fs");
const path = require("path");

const args = {};
for (let i = 2; i < process.argv.length; i += 2)
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!args.records) {
  console.error("usage: node server/export-for-postgres.js --records <dir> [--out <dir>]");
  process.exit(1);
}
const OUT = args.out || "server/data";
fs.mkdirSync(OUT, { recursive: true });

const q = v => {
  if (v == null || v === "") return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (header, rows) =>
  header.join(",") + "\n" + rows.map(r => r.map(q).join(",")).join("\n") + "\n";

/* 0 means "never happened", not 1 Jan 1970 */
const stamp = ms => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : "");
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

const recs = [];
for (const f of fs.readdirSync(args.records)) {
  if (!f.endsWith(".json")) continue;
  const j = JSON.parse(fs.readFileSync(path.join(args.records, f), "utf8"));
  recs.push({ ...(j.data || j), _id: f.replace(/\.json$/, "") });
}
console.log("records read: " + recs.length);

/* ------------------------------------------------------------- parcels ---- */
const PARCEL_COLS = ["barcode","name","item_id","client_id","customer","phone","shipment",
  "status","zone","shelf","qty","weight_kg","cbm","dims","declared","cny","cost","currency",
  "paid","paid_at","pay_method","origin","route","notes",
  "inbound_at","shipped_at","received_at","shelved_at","released_at","delivered_at","updated_at"];

const seen = new Set();
const parcels = [];
let dupes = 0;
for (const r of recs) {
  const bc = String(r.barcode || "").trim();
  if (!bc) continue;
  if (seen.has(bc)) { dupes++; continue; }
  seen.add(bc);
  parcels.push([
    bc, r.name, r.itemId, r.clientId, r.customer, r.phone, r.parcel,
    r.status || "received", r.zone, r.shelf,
    num(r.qty), num(r.weightKg), num(r.cbm), r.dims,
    num(r.declared), num(r.cny), num(r.cost), r.currency || "USD",
    r.paid === true ? "true" : "false", stamp(r.paidAt), r.payMethod,
    r.origin, r.route, r.notes,
    stamp(r.inboundAt), stamp(r.shippedAt), stamp(r.receivedAt),
    stamp(r.shelvedAt), stamp(r.releasedAt), stamp(r.deliveredAt),
    stamp(r.updatedAt) || new Date().toISOString(),
  ]);
}
fs.writeFileSync(path.join(OUT, "parcels.csv"), csv(PARCEL_COLS, parcels));
console.log("parcels.csv      " + parcels.length + " rows" + (dupes ? "  (" + dupes + " duplicate barcodes dropped)" : ""));

/* -------------------------------------------------------------- events ---- */
/* The artifact kept the last 25 moves on each record. They carry a Claude user
   id, which means nothing in the new database, so the actor is left null and
   the name is kept in the note — honest about what is known. */
const EVENT_COLS = ["barcode", "at", "from_status", "to_status", "loc", "note"];
const events = [];
for (const r of recs) {
  const bc = String(r.barcode || "").trim();
  if (!bc || !Array.isArray(r.hist)) continue;
  for (const h of r.hist) {
    if (!h || !h.t) continue;
    events.push([bc, stamp(h.t), h.from || "", h.to || "", h.loc || "", h.note || ""]);
  }
}
events.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
fs.writeFileSync(path.join(OUT, "parcel_events.csv"), csv(EVENT_COLS, events));
console.log("parcel_events.csv " + events.length + " rows");

/* --------------------------------------------------------------- zones ---- */
/* Zones live in their own collection in the artifact; if the dump has none,
   write the layout the warehouse actually uses so the tables are not empty. */
const ZONE_COLS = ["code", "label", "kind", "racks", "levels", "sort"];
const zoneFile = path.join(args.records, "..", "zones");
let zones = [];
if (fs.existsSync(zoneFile)) {
  for (const f of fs.readdirSync(zoneFile)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(fs.readFileSync(path.join(zoneFile, f), "utf8"));
    const z = j.data || j;
    zones.push([z.code, z.label || z.code, z.kind || "shelf", z.racks || "", z.levels || "", z.sort || 0]);
  }
}
if (!zones.length) {
  zones = [["A","Zone A","shelf",10,5,1], ["B","Zone B","shelf",24,5,2],
           ["C","Zone C","shelf",22,5,3], ["D","Zone D","shelf",8,5,4],
           ["SHIP","Shipping department","staging","","",5]];
  console.log("(no zones in the dump — wrote the A/B/C/D layout plus the shipping department)");
}
fs.writeFileSync(path.join(OUT, "zones.csv"), csv(ZONE_COLS, zones));
console.log("zones.csv        " + zones.length + " rows");

/* ------------------------------------------------------------- summary ---- */
const by = {};
parcels.forEach(p => { by[p[7]] = (by[p[7]] || 0) + 1; });
console.log("\nby status: " + JSON.stringify(by));
const withShelf = parcels.filter(p => p[9]).length;
const money = parcels.reduce((s, p) => s + Number(p[16] || 0), 0);
console.log("with a shelf: " + withShelf + "   charged: $" + money.toFixed(2));
console.log("\nLoad order matters — parcels before parcel_events, which reference them.");
