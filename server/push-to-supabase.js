#!/usr/bin/env node
/* Push the artifact dump straight into the project's staging tables.
 *
 *   SUPABASE_URL=… SUPABASE_KEY=… node server/push-to-supabase.js \
 *     --records reports/final/items-raw/items [--only parcels|events]
 *
 * The rows go from this machine to Postgres over HTTPS, so nothing has to be
 * retyped on the way. Both loaders are temporary and write only to staging.
 *
 * Parcels are keyed on the barcode and ignore conflicts, so re-running is
 * safe. Events are not keyed, so a chunk that half-landed must be cleared by
 * barcode before it is sent again — the script reports exactly what each
 * chunk inserted so that can be checked.
 */
const fs = require("fs");
const path = require("path");

const args = {};
for (let i = 2; i < process.argv.length; i += 2)
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const RECS = args.records || "reports/final/items-raw/items";
const ONLY = args.only || "both";
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error("SUPABASE_URL and SUPABASE_KEY must be set"); process.exit(1); }

const txt = v => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
/* milliseconds in the artifact, whole seconds on the wire; 0 means never */
const sec = v => { const x = Number(v); return x > 0 ? Math.round(x / 1000) : 0; };

const recs = [];
for (const f of fs.readdirSync(RECS)) {
  if (!f.endsWith(".json")) continue;
  const j = JSON.parse(fs.readFileSync(path.join(RECS, f), "utf8"));
  recs.push(j.data || j);
}
recs.sort((a, b) => String(a.barcode).localeCompare(String(b.barcode)));

const parcels = [], events = [];
let noBarcode = 0;
for (const r of recs) {
  const barcode = String(r.barcode || "").trim();
  if (!barcode) { noBarcode++; continue; }
  parcels.push({
    barcode, name: txt(r.name), item_id: txt(r.itemId), client_id: txt(r.clientId),
    customer: txt(r.customer), phone: txt(r.phone), shipment: txt(r.parcel),
    status: txt(r.status || "received"), zone: txt(r.zone), shelf: txt(r.shelf),
    qty: Math.round(num(r.qty)), weight_kg: num(r.weightKg), cbm: num(r.cbm), dims: txt(r.dims),
    declared: num(r.declared), cny: num(r.cny), cost: num(r.cost),
    paid: r.paid === true, paid_at: sec(r.paidAt), pay_method: txt(r.payMethod),
    origin: txt(r.origin), route: txt(r.route), notes: txt(r.notes),
    inbound_at: sec(r.inboundAt), shipped_at: sec(r.shippedAt), received_at: sec(r.receivedAt),
    shelved_at: sec(r.shelvedAt), released_at: sec(r.releasedAt), delivered_at: sec(r.deliveredAt),
    updated_at: sec(r.updatedAt),
  });
  if (Array.isArray(r.hist))
    for (const h of r.hist) {
      if (!h || !h.t) continue;
      events.push({ barcode, at: sec(h.t), from_status: txt(h.from),
        to_status: txt(h.to), loc: txt(h.loc), note: txt(h.note) });
    }
}
console.log("parcels " + parcels.length + "   events " + events.length +
  (noBarcode ? "   (" + noBarcode + " with no barcode skipped)" : ""));

async function send(fn, rows) {
  const res = await fetch(URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + body.slice(0, 300));
  return Number(body) || 0;
}

async function push(fn, rows, size, label) {
  let done = 0, inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    let got, lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { got = await send(fn, chunk); break; }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1000 * attempt)); }
    }
    if (got === undefined) throw new Error(label + " chunk at row " + i + " failed: " + lastErr.message);
    done += chunk.length; inserted += got;
    console.log("  " + label + " " + done + "/" + rows.length + "  (+" + got + ")");
  }
  console.log(label + ": " + inserted + " rows inserted of " + rows.length + " sent");
}

(async () => {
  if (ONLY === "both" || ONLY === "parcels") await push("_load_parcels", parcels, 1000, "parcels");
  if (ONLY === "both" || ONLY === "events") await push("_load_events", events, 2000, "events");
  console.log("done");
})().catch(e => { console.error("FAILED: " + e.message); process.exit(1); });
