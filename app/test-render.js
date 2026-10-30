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

  // Stock, twice. The two row sets and the two summaries are what the
  // DATABASE actually hands each role back: the money is null for a scanner,
  // so the app never has to decide whether to draw it.
  const summary = {
    total:8232, expected:4625, received:1884, shelved:1600, released:63, delivered:60,
    late_count:3475, long_count:1049, free_days:14, long_stay_days:90,
    unpaid_count:2703, unpaid_amount:39344.95, long_owed:11503.55,
  };
  S.tab = "stock"; S.q = "pierre"; S.total = 2; S.page = 0;
  S.stats = { ...summary, unpaid_count:null, unpaid_amount:null, long_owed:null };
  S.rows = rows.map(r => ({ ...r, cost:null, paid:null }));
  build("stock-scanner", () => vStock());

  S.me = { id:"u2", name:"Office", role:"office", active:true };
  S.stats = summary;
  S.rows = rows;
  build("stock-office", () => vStock());

  S.filters = { status:"shelved", zone:"C", paid:"long" };
  build("stock-filtered", () => vStock());
  /* what a tap on a zone card leaves behind */
  S.filters = { status:"", zone:"C", paid:"", here:true };
  build("stock-from-zone-card", () => vStock());
  S.filters = { status:"", zone:"", paid:"" }; S.q = "";
  S.rows = []; build("stock-nothing-matches", () => vStock());
  S.rows = null; build("stock-loading", () => vStock());
  S.rows = rows; S.searching = true; build("stock-searching", () => vStock());
  S.searching = false;
  S.stats = null; build("stock-counting", () => vStock());
  S.stats = summary;

  // paging: a middle page must offer both directions
  S.total = 8232; S.page = 3; S.pageSize = 50;
  build("stock-paged", () => vStock());
  S.page = 0; S.total = 2;

  // money — office and admin only
  S.tab = "money";
  S.money = {
    billed:46945.88, owed:39344.95, collected:7600.93,
    billed_count:3607, unpaid_count:2703, customers:501,
    unpriced_count:18, unpriced_customers:2, lbp_rate:89500,
  };
  S.cfg = { lanes:[
    { label:"Air · Hong Kong", match:"Air Cargo Hk", basis:"kg", price:16.5 },
    { label:"Air · Guangzhou", match:"Air Cargo LB", basis:"kg", price:14.5 },
    { label:"Sea", match:"Sea Cargo", basis:"cbm", price:450 },
    { label:"Unset lane", match:"Nothing", basis:"kg", price:0 },
  ] };
  S.customers = [
    { client_id:"1000001", customer:"User_EXMPL", phone:"+96170000001",
      parcels:1185, unpaid:1185, total:22579.10, owed:22579.10,
      oldest_unpaid_days:98, total_rows:501 },
    { client_id:"65", customer:"No charge yet", phone:null,
      parcels:17, unpaid:17, total:0, owed:0,
      oldest_unpaid_days:140, total_rows:501 },
  ];
  S.custTotal = 501; S.custPage = 0; S.custPageSize = 50; S.custOwing = true;
  build("money", () => vMoney());
  S.custPage = 2; build("money-paged", () => vMoney());
  S.custPage = 0;
  S.customers = []; build("money-none", () => vMoney());
  S.customers = null; build("money-loading", () => vMoney());
  S.money = null; build("money-adding-up", () => vMoney());

  // the payment dialog has to build too
  S.money = { billed:1, owed:1, collected:0, billed_count:1, unpaid_count:1,
              customers:1, unpriced_count:0, unpriced_customers:0, lbp_rate:89500 };
  try {
    askPayment({ client_id:"1000001", customer:"User_EXMPL", unpaid:1185, owed:22579.10 });
    out["payment-dialog"] = { ok:true, text:document.body.children
      .map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["payment-dialog"] = { ok:false, err:e && e.message }; }

  // a scanner must not be offered Money at all
  S.me = { id:"u1", name:"Ali Nasser", role:"scanner", active:true };
  out["tabs-scanner"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  out["tabs-office"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };
  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  out["tabs-admin"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };

  // zones
  S.tab = "zones";
  S.zoneStats = [
    { code:"A", label:"Zone A", kind:"shelf", racks:10, levels:5, capacity:0,
      note:"A1-01-01 to A10-01-05", sort:1, parcels:412, locations_used:44 },
    { code:"C", label:"Zone C", kind:"shelf", racks:22, levels:5, capacity:0,
      note:null, sort:3, parcels:489, locations_used:99 },
    { code:"SHIP", label:"Shipping department", kind:"staging", racks:null, levels:null,
      capacity:300, note:"Waiting to be put on shelves", sort:6, parcels:1884, locations_used:0 },
  ];
  build("zones", () => vZones());
  S.zoneStats = null; build("zones-loading", () => vZones());

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
expect("stock-office", "$25.01");
expect("stock-office", "Unpaid");
expect("stock-office", "$39,344.95");
expect("stock-scanner", "C18-01-01");
expect("stock-scanner", "On shelves");
expect("stock-office", "Over free days");
expect("stock-office", "past 14 days");
expect("stock-office", "90+ days");
expect("stock-filtered", "Clear");
expect("stock-from-zone-card", "in the building");
expect("stock-nothing-matches", "Nothing matches");
/* The fixture puts two rows on page 4, so the pager counts the rows actually
   on screen rather than assuming a full page. */
expect("stock-paged", "151–152 of 8,232");
expect("zones", "Zone C");
expect("zones", "22 racks × 5 levels · 99 of 110 locations in use");
expect("zones", "Staging areas");
expect("staff", "Ali Nasser");
expect("staff", "Turned off");
expect("money", "$39,344.95");
expect("money", "3,521,373,025 LL");   /* 39,344.95 × 89,500 */
expect("money", "680,283,235 LL");     /* collected, same rate */
expect("money", "Not priced yet");
expect("money", "User_EXMPL");
expect("money", "oldest held 98 days");
expect("money", "Take payment");
expect("money", "Settled");
expect("money", "$16.50 / kg");
expect("money", "$450.00 / cbm");
expect("money", "not set");
expect("money-paged", "101–102 of 501");
expect("payment-dialog", "across 1,185 parcels");
expect("payment-dialog", "Mark $22,579.10 paid");

/* The tabs themselves must not offer a scanner the money. */
const tabs = n => ((out[n] || {}).text || "");
if (/Money/.test(tabs("tabs-scanner"))) {
  fail++; console.log("  FAIL  a scanner is offered Money: " + tabs("tabs-scanner"));
} else pass++;
for (const who of ["tabs-office", "tabs-admin"]) {
  if (!/Money/.test(tabs(who))) { fail++; console.log("  FAIL  " + who + " has no Money tab"); }
  else pass++;
}
if (/Staff/.test(tabs("tabs-office"))) {
  fail++; console.log("  FAIL  office is offered Staff: " + tabs("tabs-office"));
} else pass++;

/* The money must not appear for a scanner, however the view is built: not in
   a row, and not in a tile either. */
const scannerText = (out["stock-scanner"] || {}).text || "";
if (/\$|25\.01|39,344|11,503|Unpaid/.test(scannerText)) {
  fail++; console.log("  FAIL  stock-scanner shows money: " +
    scannerText.replace(/\s+/g, " ").slice(0, 240));
} else pass++;

console.log("\n" + Object.keys(out).length + " views built, " + pass + " checks passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
