#!/usr/bin/env node
/* Read a real dashboard export with the app's own importer.
 *
 *   node app/test-import.js <path to .xlsx or .csv>
 *
 * The parsing, the header guessing and the row building are lifted out of the
 * published page and run here against the actual file, because a column alias
 * that no longer matches is invisible until someone imports a week's work and
 * finds half the fields empty.
 *
 * The file is untrusted input: it is only ever read, by path, as an argument.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const target = process.argv[2];
if (!target) { console.error("usage: node app/test-import.js <file>"); process.exit(1); }

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
let mod = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
mod = mod.replace(/^\s*import\s[\s\S]*?;\s*$/m, "");

/* The same minimal DOM as the render tests: the module builds a little at
   load time and must not fall over. */
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
    body: node("body"),
    addEventListener() {},
  },
  window: {}, navigator: {}, location: { href: "http://test/" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: fn => { try { fn(); } catch (_) {} return 0; },
  addEventListener() {},
  Intl, Date, JSON, Math, String, Number, Boolean, Array, Object, Error, RegExp,
  Promise, console, isFinite, parseFloat, parseInt,
  /* what the xlsx reader needs, all of it already in the platform */
  DecompressionStream, Blob, Response, TextDecoder, DataView, Uint8Array,
  createClient: () => ({ auth: {}, from: () => ({}) }),
  __file: { name: path.basename(target), bytes: fs.readFileSync(target) },
  __out: {},
});

mod += `
;(async () => {
  const out = __out;
  const f = {
    name: __file.name,
    arrayBuffer: async () => __file.bytes.buffer.slice(
      __file.bytes.byteOffset, __file.bytes.byteOffset + __file.bytes.byteLength),
    text: async () => new TextDecoder().decode(__file.bytes),
  };
  let rows;
  if (/\\.xlsx$/i.test(f.name)) rows = await readXlsx(f);
  else rows = parseCsv(await f.text());
  rows = rows.filter(r => r && r.some(c => String(c == null ? "" : c).trim() !== ""));

  const headers = rows[0].map(h => String(h == null ? "" : h).trim());
  const data = rows.slice(1);
  const map = guessMap(headers);

  S.cfg = { cnyPerUsd: 6.1 };
  S.imp = { headers, data, map, status: "received", zone: "" };
  const built = buildImportRows();

  out.headers = headers;
  out.rowCount = data.length;
  out.map = map;
  out.built = built;
  out.sample = built.rows.slice(0, 3);
  __out.done = true;
})().catch(e => { __out.error = e && (e.stack || e.message); __out.done = true; });
`;

vm.runInContext(mod, ctx);

/* The epilogue is async; give it a moment, then report. */
setTimeout(() => {
  const o = ctx.__out;
  if (o.error) { console.error("FAILED: " + o.error); process.exit(1); }
  if (!o.done) { console.error("FAILED: the importer never finished"); process.exit(1); }

  console.log("file     " + path.basename(target));
  console.log("rows     " + o.rowCount);
  console.log("columns  " + o.headers.length);
  console.log("\nheaders the sheet actually carries:");
  o.headers.forEach((h, i) => console.log("  " + String(i).padStart(2) + "  " + h));

  console.log("\nwhat the app matched them to:");
  const inv = {};
  for (const k in o.map) inv[o.map[k]] = k;
  let matched = 0;
  o.headers.forEach((h, i) => {
    if (inv[i]) { matched++; console.log("  " + inv[i].padEnd(14) + "← " + h); }
  });
  const unmatched = o.headers.filter((h, i) => !inv[i] && h);
  console.log("\n  " + matched + " of " + o.headers.length + " columns used");
  if (unmatched.length) console.log("  ignored: " + unmatched.join(" | "));

  const b = o.built;
  console.log("\nrows built: " + b.rows.length +
    (b.noBarcode ? "  (" + b.noBarcode + " with no barcode skipped)" : "") +
    (b.dupes ? "  (" + b.dupes + " repeated barcodes)" : ""));

  /* Which fields actually came out with something in them. */
  const filled = {};
  for (const r of b.rows) for (const k in r) filled[k] = (filled[k] || 0) + 1;
  console.log("\nfields filled, out of " + b.rows.length + " rows:");
  for (const [k, n] of Object.entries(filled).sort((a, b2) => b2[1] - a[1]))
    console.log("  " + k.padEnd(12) + String(n).padStart(6) +
      (n === b.rows.length ? "  (every row)" : ""));

  console.log("\nfirst row as it would be sent:");
  console.log(JSON.stringify(o.sample[0], null, 2));

  if (b.emptyCols && b.emptyCols.length)
    console.log("\nmapped but blank in every row:\n  " + b.emptyCols.join("\n  "));

  /* The checks that matter. A column the dashboard exported empty is the
     file's problem, not the app's — what matters is that the app noticed. */
  let bad = 0;
  const need = ["barcode", "name", "customer", "client_id", "weight_kg", "cny", "route"];
  for (const k of need)
    if (!filled[k]) { bad++; console.log("\n  MISSING: nothing mapped to " + k); }
  if (!filled.cbm && !(b.emptyCols || []).some(c => /Volume/i.test(c))) {
    bad++;
    console.log("\n  WRONG: volume is empty and the app did not say so");
  }
  if (o.map.shelf != null) {
    bad++;
    console.log("\n  WRONG: the stale location column was mapped by default");
  }
  if (!b.rows.length) { bad++; console.log("\n  WRONG: no rows built at all"); }
  console.log(bad ? "\n" + bad + " PROBLEMS" : "\nall checks passed");
  process.exit(bad ? 1 : 0);
}, 3000);
