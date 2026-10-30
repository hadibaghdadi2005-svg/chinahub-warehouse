#!/usr/bin/env node
/* Checksum the artifact dump exactly as Postgres checksums the loaded tables,
 * so the two can be compared field by field rather than only in total.
 *
 *   node server/checksum-dump.js --records reports/final/items-raw/items
 *
 * Both sides build one pipe-separated line per row, sort the lines as text and
 * MD5 the result. Numbers are written to a fixed number of decimals and dates
 * as whole epoch seconds, so neither side's own formatting can make a
 * difference that is not really there.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const args = {};
for (let i = 2; i < process.argv.length; i += 2)
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const RECS = args.records || "reports/final/items-raw/items";

const t = v => String(v == null ? "" : v);
const f = (v, dp) => (Number(v) || 0).toFixed(dp);
const sec = v => String(Number(v) > 0 ? Math.round(Number(v) / 1000) : 0);

const pLines = [], eLines = [];
for (const file of fs.readdirSync(RECS)) {
  if (!file.endsWith(".json")) continue;
  const j = JSON.parse(fs.readFileSync(path.join(RECS, file), "utf8"));
  const r = j.data || j;
  const barcode = t(r.barcode).trim();
  if (!barcode) continue;
  pLines.push([
    barcode, t(r.name), t(r.itemId), t(r.clientId), t(r.customer), t(r.phone), t(r.parcel),
    t(r.status || "received"), t(r.zone), t(r.shelf),
    String(Math.round(Number(r.qty) || 0)),
    f(r.weightKg, 3), f(r.cbm, 6), t(r.dims),
    f(r.declared, 2), f(r.cny, 2), f(r.cost, 2),
    r.paid === true ? "1" : "0", sec(r.paidAt),
    t(r.payMethod), t(r.origin), t(r.route), t(r.notes),
    sec(r.inboundAt), sec(r.shippedAt), sec(r.receivedAt),
    sec(r.shelvedAt), sec(r.releasedAt), sec(r.deliveredAt),
  ].join("|"));

  if (Array.isArray(r.hist))
    for (const h of r.hist) {
      if (!h || !h.t) continue;
      eLines.push([barcode, sec(h.t), t(h.from), t(h.to), t(h.loc), t(h.note)].join("|"));
    }
}

/* Postgres orders text by the database's collation; C ordering on the raw
   bytes is what `order by line` gives here, so compare that way. */
const byBytes = (a, b) => (Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
const md5 = lines => crypto.createHash("md5")
  .update(lines.slice().sort(byBytes).join("\n"), "utf8").digest("hex");

console.log("parcels  " + String(pLines.length).padStart(6) + "   " + md5(pLines));
console.log("events   " + String(eLines.length).padStart(6) + "   " + md5(eLines));
