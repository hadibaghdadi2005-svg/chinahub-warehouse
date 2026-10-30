#!/usr/bin/env node
/* Build every view the app can show, without a browser and without signing in.
 *
 *   node app/test-render.js
 *
 * A view that throws while building shows the user a blank screen, and that is
 * the one failure a syntax check will not catch. So the real module is loaded
 * against a small DOM, the state is set to each case by hand, and each view is
 * built and inspected.
 *
 * The test code is appended to the module source rather than run beside it,
 * because the app's state lives in a `const` inside the module and nothing
 * outside its own scope can reach it.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
let mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
mod = mod.replace(/^\s*import\s[\s\S]*?;\s*$/m, "");   /* the CDN import */

/* ------------------------------------------------------------------ DOM --- */
function node(tag) {
  const n = {
    tagName: String(tag).toUpperCase(), children: [], style: {}, dataset: {},
    className: "", _text: "", attrs: {}, listeners: {},
    get textContent() {
      return this._text + this.children.map(c => c.textContent).join("");
    },
    set textContent(v) { this._text = v == null ? "" : String(v); this.children = []; },
    append(...xs) {
      for (const x of xs)
        this.children.push(typeof x === "object" && x ? x : { textContent: String(x), children: [], className: "" });
    },
    replaceChildren(...xs) { this.children = []; this.append(...xs); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    remove() {},
    focus() {}, select() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return n;
}
const all = n => [n, ...n.children.flatMap(c => (c && c.children ? all(c) : [c]))];
const classes = n => all(n).map(x => (x && x.className) || "").join(" ");

const documentShim = {
  createElement: node,
  createTextNode: t => ({ textContent: String(t), children: [], className: "" }),
  createDocumentFragment: () => node("fragment"),
  querySelector: () => node("div"),
  body: node("body"),
  addEventListener() {},
};

const sb = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange() {},
    signOut: async () => ({}),
  },
  from() {
    const q = new Proxy({}, { get: () => (...a) => q });
    q.then = undefined;
    return q;
  },
};

const ctx = vm.createContext({
  document: documentShim,
  window: { claude: null, AudioContext: null },
  navigator: {},
  location: { href: "http://test/" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; },
  addEventListener() {},
  Intl, Date, JSON, Math, String, Number, Boolean, Array, Object, Error, RegExp, Promise,
  console,
  createClient: () => sb,
  __out: {},
});

/* What the test does once the module has defined everything. */
mod += `
;(() => {
  const out = __out;
  const zones = [
    { code:"A", label:"Zone A", kind:"shelf", racks:10, levels:5, sort:1 },
    { code:"C", label:"Zone C", kind:"shelf", racks:22, levels:5, sort:3 },
    { code:"SHIP", label:"Shipping department", kind:"staging", sort:6 },
  ];
  const rows = [
    { barcode:"YT7600000000001", name:"A long product name", customer:"Karim Nassif",
      shipment:"SH2025100000001", status:"shelved", zone:"C", shelf:"C18-01-01",
      cost:25.01, paid:false, shipped_at:"2026-07-14T00:00:00Z" },
    { barcode:"110000000000001", name:null, customer:null, shipment:null,
      status:"received", zone:"SHIP", shelf:null,
      cost:null, paid:null, shipped_at:null },
  ];

  const build = (label, fn) => {
    try { const n = fn(); out[label] = { ok:true, text:n.textContent, cls:
      (function cls(x){ return [x.className||"", ...(x.children||[]).map(c=>c?cls(c):"")].join(" "); })(n) }; }
    catch (e) { out[label] = { ok:false, err: e && e.message }; }
  };

  S.sb = sb_stub;
  S.zones = zones;

  // not signed in
  S.session = null; S.me = null;
  build("signIn", () => vSignIn());

  // signed in, no role
  S.session = { user:{ id:"u1", email:"nobody@example.com" } };
  build("noAccess", () => vNoAccess());

  // scanner
  S.me = { id:"u1", name:"Ali Nasser", role:"scanner", active:true };
  S.tab = "scan";
  for (const m of ["lookup","receive","shelve","release","deliver"]) {
    S.mode = m;
    build("scan-" + m, () => vScan());
  }
  S.mode = "shelve"; S.dest = { zone:"C", shelf:"C18-01-01" };
  build("scan-with-shelf", () => vScan());
  S.scanFeed = [
    { kind:"ok",   bc:"YT7600000000001", msg:"Shelved: a parcel → C18-01-01", t:Date.now() },
    { kind:"warn", bc:"110000000000001", msg:"already on a shelf", t:Date.now() },
    { kind:"bad",  bc:"B25-01-01",       msg:"Zone B has racks 1–24", t:Date.now() },
  ];
  S.undo = { barcode:"YT7600000000001", name:"a parcel", before:{ status:"received", zone:"SHIP", shelf:null } };
  build("scan-with-feed", () => vScan());

  // Records, twice. The two row sets are what the DATABASE actually hands
  // each role back: the view nulls the money columns for a scanner, so the
  // app never has to decide whether to draw them.
  S.tab = "records"; S.q = "pierre";
  S.rows = rows.map(r => ({ ...r, cost:null, paid:null }));
  build("records-scanner", () => vRecords());
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  S.rows = rows;
  build("records-office", () => vRecords());
  S.rows = []; build("records-empty", () => vRecords());
  S.rows = null; build("records-unsearched", () => vRecords());
  S.searching = true; build("records-searching", () => vRecords());
  S.searching = false;

  // staff
  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  S.tab = "staff";
  S.staff = [
    { id:"u3", name:"Hadi", role:"admin", active:true, created_at:"2026-10-30T11:00:00Z" },
    { id:"u1", name:"Ali Nasser", role:"scanner", active:true, created_at:"2026-10-30T12:00:00Z" },
    { id:"u4", name:"Old Hand", role:"office", active:false, created_at:"2026-01-02T00:00:00Z" },
  ];
  build("staff", () => vStaff());
  S.staff = []; build("staff-loading", () => vStaff());
})();
`;

/* `sb_stub` has to exist inside the module scope. */
vm.runInContext("var sb_stub = " + "(" + (() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() {}, signOut: async () => ({}) },
  from() { const q = new Proxy({}, { get: () => (...a) => q }); return q; },
})).toString() + ")();", ctx);

try {
  vm.runInContext(mod, ctx);
} catch (e) {
  console.error("the module itself threw: " + e.message);
  process.exit(1);
}

const out = ctx.__out;
let pass = 0, fail = 0;
for (const [name, r] of Object.entries(out)) {
  if (r.ok) { pass++; } else { fail++; console.log("  FAIL  " + name + " — " + r.err); }
}

/* A view that builds but says nothing is still broken. */
const expect = (name, needle) => {
  const r = out[name];
  if (!r || !r.ok) return;
  if (!(r.text + " " + r.cls).includes(needle)) {
    fail++; console.log("  FAIL  " + name + " does not mention " + JSON.stringify(needle));
  } else pass++;
};
expect("signIn", "Sign in");
expect("noAccess", "cannot see the warehouse");
expect("scan-lookup", "changes nothing");
expect("scan-shelve", "onto a shelf");
expect("scan-with-shelf", "C18-01-01");
expect("scan-with-feed", "Undo");
expect("scan-with-feed", "racks 1–24");
expect("records-office", "$25.01");
expect("records-scanner", "C18-01-01");
expect("staff", "Ali Nasser");
expect("staff", "Turned off");

/* The money must not appear for a scanner, however the view is built. */
const scannerText = (out["records-scanner"] || {}).text || "";
if (/25\.01|\$/.test(scannerText)) {
  fail++; console.log("  FAIL  records-scanner shows money: " + scannerText.slice(0, 200));
} else pass++;

console.log("\n" + Object.keys(out).length + " views built, " + pass + " checks passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
