#!/usr/bin/env node
/* Run a real shipping export through the app's own reader.
 *
 *   node app/test-shipping.js <path to the shipping .xlsx>
 *
 * The sheet has forty-two columns, most of them unused, and keeps its dates
 * as Excel serial numbers with 1 standing for "not set". What matters is that
 * the right columns are picked out, that a date of 1 does not become 1900,
 * and that sea is charged on volume while air is charged on weight — the two
 * are not interchangeable and billing the wrong one would be invisible.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const target = process.argv[2];
if (!target) { console.error("usage: node app/test-shipping.js <file>"); process.exit(1); }

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
let mod = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
mod = mod.replace(/^\s*import\s[\s\S]*?;\s*$/m, "");

function node(tag) {
  const n = {
    tagName: String(tag).toUpperCase(), children: [], style: {}, dataset: {},
    className: "", _text: "", attrs: {}, listeners: {},
    get textContent() { return this._text + this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this._text = v == null ? "" : String(v); this.children = []; },
    append(...xs) {
      for (const x of xs)
        this.children.push(typeof x === "object" && x ? x
          : { textContent: String(x), children: [], className: "" });
    },
    replaceChildren(...xs) { this.children = []; this.append(...xs); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    remove() {}, focus() {}, select() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
  return n;
}

const { readSheet } = require(path.join(__dirname, "..", "scripts", "xlsx.js"));
const sheet = readSheet(target, 1);

const ctx = vm.createContext({
  document: {
    createElement: node,
    createTextNode: t => ({ textContent: String(t), children: [], className: "" }),
    createDocumentFragment: () => node("fragment"),
    querySelector: () => node("div"),
    body: node("body"), addEventListener() {},
  },
  window: {}, navigator: {}, location: { href: "http://test/" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: fn => { try { fn(); } catch (_) {} return 0; },
  addEventListener() {},
  Intl, Date, JSON, Math, String, Number, Boolean, Array, Object, Error, RegExp,
  Promise, console, isFinite, parseFloat, parseInt, isNaN, Set, Map,
  createClient: () => ({ auth: {}, from: () => ({}) }),
  __sheet: sheet, __name: path.basename(target), __out: {},
});

mod += `
;(() => {
  const out = __out;
  S.me = { id:"u", name:"Office", role:"office", active:true };
  const rows = __sheet.filter(r => r && r.some(c => String(c == null ? "" : c).trim() !== ""));
  const headers = rows[0].map(h => String(h == null ? "" : h).trim());
  out.isShipping = isShippingFile(headers);
  out.isScan = isScanFile(headers);
  S.imp = { fileName: __name, headers, data: rows.slice(1), kind: "shipping", map: {} };
  const b = buildShipmentRows();
  out.built = b.rows.length;
  out.noNumber = b.noNumber;
  out.odd = b.odd;
  out.rows = b.rows;
  try { out.screen = shippingImportSection().textContent; }
  catch (e) { out.screenErr = e.message; }

  S.shipStats = { total_all: b.rows.length, shipments: b.rows.length,
    sea: b.rows.filter(r => r.mode === "sea").length,
    air: b.rows.filter(r => r.mode === "air").length,
    billed: b.rows.reduce((s,r) => s + r.total, 0),
    collected: b.rows.reduce((s,r) => s + r.paid_amount, 0),
    outstanding: b.rows.reduce((s,r) => s + r.total - r.paid_amount, 0),
    unpaid_count: b.rows.filter(r => !r.paid_at).length,
    undelivered: b.rows.filter(r => !r.delivered_at).length,
    clients: new Set(b.rows.map(r => r.client)).size,
    containers: new Set(b.rows.map(r => r.container).filter(Boolean)).size };
  S.ships = b.rows.slice(0, 5);
  S.shipQ = ""; S.shipFilters = { mode:"", paid:"" };
  try { out.tab = vShipping().textContent; } catch (e) { out.tabErr = e.message; }
})();
`;

vm.runInContext(mod, ctx);
const o = ctx.__out;

console.log("file        " + path.basename(target));
console.log("read as     " + (o.isShipping ? "a SHIPPING export" : "NOT shipping"));
console.log("shipments   " + o.built + (o.noNumber ? "  (" + o.noNumber + " with no number skipped)" : ""));

const sea = o.rows.filter(r => r.mode === "sea");
const air = o.rows.filter(r => r.mode === "air");
const sum = (a, k) => a.reduce((s, r) => s + (Number(r[k]) || 0), 0);
console.log("by sea      " + sea.length + "  " + sum(sea, "volume_cbm").toFixed(3) +
  " CBM  $" + sum(sea, "total").toFixed(2));
console.log("by air      " + air.length + "  " + sum(air, "weight_kg").toFixed(1) +
  " kg  $" + sum(air, "total").toFixed(2));
console.log("billed      $" + sum(o.rows, "total").toFixed(2));
console.log("paid        $" + sum(o.rows, "paid_amount").toFixed(2));
console.log("clients     " + new Set(o.rows.map(r => r.client)).size);
console.log("containers  " + new Set(o.rows.map(r => r.container).filter(Boolean)).size);

console.log("\ndates read back:");
const withDate = o.rows.filter(r => r.raised_at).slice(0, 3);
for (const r of withDate)
  console.log("  #" + r.ship_num + "  raised " + r.raised_at + "  arrived " + r.arrived_at +
    "  delivered " + (r.delivered_at || "—") + "  paid " + (r.paid_at || "—"));

console.log("\nfirst shipment as it would be stored:");
console.log(JSON.stringify(o.rows[0], null, 2));

if (o.odd.length) {
  console.log("\ntotals that do not match their own price:");
  for (const x of o.odd) console.log("  #" + x.ship_num + " " + x.mode +
    " sheet " + x.total + " vs " + x.expect);
}

let fail = 0;
const check = (what, ok) => { if (!ok) { fail++; console.log("\n  FAIL  " + what); } };
check("recognised as a shipping export", o.isShipping);
check("not mistaken for a floor scan", !o.isScan);
check("every row has a shipment number", o.built === o.rows.length && o.built > 0);
check("sea and air both present", sea.length > 0 && air.length > 0);
check("dates come back as real dates, not 1900",
  o.rows.every(r => !r.raised_at || r.raised_at > "2020-01-01"));
check("a date of 1 becomes nothing",
  o.rows.some(r => r.delivered_at === null));
check("every total matches its own price", o.odd.length === 0);
check("the import screen builds", !o.screenErr);
check("the Shipping tab builds", !o.tabErr);
check("the tab shows sea and air", !o.tabErr && /By sea/.test(o.tab) && /By air/.test(o.tab));
console.log(fail ? "\n" + fail + " PROBLEMS" : "\nall checks passed");
process.exit(fail ? 1 : 0);
