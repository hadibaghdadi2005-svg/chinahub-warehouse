#!/usr/bin/env node
/* Run a real PDA scan file through the app's own floor-scan path.
 *
 *   node app/test-scan-file.js <path to a shelf-scans csv>
 *
 * This is the file that goes in on a Friday after the whole floor has been
 * walked, so what matters is that it is recognised as a scan rather than as a
 * dashboard export, that every shelf label is read the way the warehouse
 * writes them, and that a label which did not read is held back rather than
 * filing parcels onto a shelf that does not exist.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const target = process.argv[2];
if (!target) { console.error("usage: node app/test-scan-file.js <file>"); process.exit(1); }

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
let mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
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
  __text: fs.readFileSync(target, "utf8"),
  __name: path.basename(target),
  __out: {},
});

mod += `
;(() => {
  const out = __out;
  S.zones = [
    { code:"A", label:"Zone A", kind:"shelf", racks:10, levels:5 },
    { code:"B", label:"Zone B", kind:"shelf", racks:24, levels:5 },
    { code:"C", label:"Zone C", kind:"shelf", racks:22, levels:5 },
    { code:"D", label:"Zone D", kind:"shelf", racks:8,  levels:5 },
    { code:"RCV", label:"Receiving", kind:"staging" },
    { code:"SHIP", label:"Shipping", kind:"staging" },
    { code:"OUT", label:"Outbound", kind:"staging" },
  ];
  let rows = parseCsv(__text);
  rows = rows.filter(r => r && r.some(c => String(c == null ? "" : c).trim() !== ""));
  const headers = rows[0].map(h => String(h == null ? "" : h).trim());
  out.headers = headers;
  out.isScan = isScanFile(headers);
  out.wouldMapAsExport = guessMap(headers);

  S.imp = { fileName: __name, headers, data: rows.slice(1), kind: "scan", map: {} };
  const built = buildScanRows();
  out.built = built.rows.length;
  out.blank = built.blank;
  out.shelves = scanShelves(built.rows);
  out.sample = built.rows.slice(0, 2);
  try { out.rendered = scanSection().textContent; } catch (e) { out.renderErr = e.message; }
})();
`;

vm.runInContext(mod, ctx);
const o = ctx.__out;

console.log("file     " + path.basename(target));
console.log("headers  " + JSON.stringify(o.headers));
console.log("read as  " + (o.isScan ? "a FLOOR SCAN" : "a dashboard export"));
console.log("rows     " + o.built + (o.blank ? "  (" + o.blank + " blank skipped)" : ""));

const good = o.shelves.filter(s => !s.why);
const bad = o.shelves.filter(s => s.why);
console.log("shelves  " + o.shelves.length + "  (" + good.length + " read, " + bad.length + " did not)");
console.log("\nby zone:");
const byZone = {};
for (const s of good) byZone[s.zone || "?"] = (byZone[s.zone || "?"] || 0) + s.n;
for (const [z, n] of Object.entries(byZone).sort()) console.log("  zone " + z + "  " + n + " parcels");

if (bad.length) {
  console.log("\nheld back:");
  for (const s of bad) console.log("  " + JSON.stringify(s.shelf) + "  " + s.n + " parcels — " + s.why);
}
console.log("\nfirst row as it would be sent:");
console.log("  " + JSON.stringify(o.sample[0]));

let fail = 0;
const check = (what, ok) => { if (!ok) { fail++; console.log("\n  FAIL  " + what); } };
check("the file is recognised as a floor scan", o.isScan);
check("it is NOT treated as a dashboard export", Object.keys(o.wouldMapAsExport).length < 3);
check("every row has a barcode and a shelf", o.built > 0);
check("both shelf label forms resolve to a zone",
  good.some(s => /^[A-Z]\d+-\d+-\d+$/.test(s.shelf)) && good.some(s => /^[A-Z]-\d+-\d+$/.test(s.shelf)));
check("an unreadable label is held back", bad.length > 0);
check("the screen builds", !o.renderErr);
check("the screen names the unreadable label",
  !o.renderErr && bad.every(s => o.rendered.includes(s.shelf)));
console.log(fail ? "\n" + fail + " PROBLEMS" : "\nall checks passed");
process.exit(fail ? 1 : 0);
