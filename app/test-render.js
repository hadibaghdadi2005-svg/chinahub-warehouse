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
let mod = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
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
    { code:"HAMRA", label:"Hamra office", kind:"branch", sort:10,
      note:"Customers collect and pay here" },
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
  /* sending parcels to the branch, and the same screen with no branch set up */
  S.mode = "branch"; S.branchZone = "HAMRA";
  build("scan-to-branch", () => vScan());
  const keptZones = S.zones;
  S.zones = keptZones.filter(z => z.kind !== "branch");
  build("scan-to-branch-none", () => vScan());
  S.zones = keptZones;
  S.mode = "shelve";
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
    at_branch:0, late_count:3475, long_count:1049, free_days:14, long_stay_days:90,
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
  build("scan-office", () => vScan());
  S.soData = [
    { barcode:"YT7000000000001", name:"Phone case", customer:"Wholesale Co", shipment:"SH1", status:"received",
      shelf:"C-01-01", cost:20, paid:false, shipped_at:"2026-10-02", age_days:20 },
    { barcode:"YT7000000000002", name:"Charger", customer:"Wholesale Co", shipment:"SH1", status:"delivered",
      cost:5.5, paid:true, shipped_at:"2026-09-12", age_days:40 },
    { barcode:"YT7000000000003", name:"Cable", customer:"Wholesale Co", shipment:"SH2", status:"expected",
      cost:3, paid:false, shipped_at:"2026-10-20", age_days:0 },
  ];
  S.tab = "sales";
  build("sales-office", () => vSales());
  S.soPay = "paid";
  build("sales-paid", () => vSales());
  S.soPay = ""; S.tab = "stock";
  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  build("scan-admin", () => vScan());
  S.me = { id:"u4", name:"Desk", role:"call_center", active:true };
  build("scan-callcenter", () => vScan());
  S.me = { id:"u2", name:"Office", role:"office", active:true };

  S.filters = { status:"shelved", zone:"C", paid:"long" };
  build("stock-filtered", () => vStock());
  /* Narrowed to one client: the tiles must show that client's figures and say
     what they are narrowed from. */
  S.filters = { status:"", zone:"", paid:"", client:"1000001" };
  S.stats = { ...summary, total_all:8232, total:1605,
              expected:419, received:1184, shelved:2, released:0, delivered:0,
              unpaid_count:1185, unpaid_amount:22579.10 };
  build("stock-one-client", () => vStock());
  S.stats = { ...summary, total_all:8232, total:8232 };
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
    { client_id:"99", customer:"No charge yet", phone:null,
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

  // the parcel drawer
  const full = {
    barcode:"YT7600000000001", name:"Carbon pool cue set", customer:"Karim Nassif",
    client_id:"1000002", phone:"0961-0000001", shipment:"SH2025100000001",
    status:"shelved", zone:"C", shelf:"C18-01-01", qty:1,
    weight_kg:1.67, cbm:0.006055, dims:"86.5×10×7 cm",
    origin:"Chinahub Guangzhou", route:"Chinahub Air Cargo LB", notes:null,
    inbound_at:"2026-07-13T00:00:00Z", shipped_at:"2026-07-15T00:00:00Z",
    received_at:"2026-10-28T14:51:02Z", shelved_at:"2026-10-29T12:36:02Z",
    released_at:null, delivered_at:null, age_days:107,
    cost:25.01, cny:152.55, declared:192.83, currency:"USD",
    paid:false, paid_at:null, pay_method:"Cash on delivery",
  };
  const events = [
    { id:3, at:"2026-10-29T12:36:02Z", actor:"u1", from_status:"received",
      to_status:"shelved", loc:"C18-01-01", note:"floor scan" },
    { id:1, at:"2026-10-28T14:51:02Z", actor:null, from_status:null,
      to_status:"received", loc:"SHIP", note:"imported from dashboard export" },
  ];
  S.cfg = { lbpRate:89500, lanes:[
    { label:"Air · Guangzhou", match:"Air Cargo LB", basis:"kg", price:14.5 },
  ] };
  S.stats = { free_days:14, long_stay_days:90 };

  S.me = { id:"u2", name:"Office", role:"office", active:true };
  S.drawer = { barcode:full.barcode, loading:false, parcel:full,
               events, names:{ u1:"Ali Nasser" } };
  build("drawer-office", () => vDrawer());

  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  build("drawer-admin", () => vDrawer());

  /* A scanner's copy is what the DATABASE would hand back: money nulled. */
  S.me = { id:"u1", name:"Ali Nasser", role:"scanner", active:true };
  S.drawer = { barcode:full.barcode, loading:false,
    parcel:{ ...full, cost:null, cny:null, declared:null, currency:null,
             paid:null, paid_at:null, pay_method:null },
    events, names:{ u1:"Ali Nasser" } };
  build("drawer-scanner", () => vDrawer());

  S.me = { id:"u2", name:"Office", role:"office", active:true };
  S.drawer = { barcode:full.barcode, loading:false,
    parcel:{ ...full, status:"at_branch", zone:"HAMRA", shelf:null,
             branched_at:"2026-10-31T09:00:00Z" },
    events, names:{ u1:"Ali Nasser" } };
  build("drawer-at-branch", () => vDrawer());

  S.drawer = { barcode:full.barcode, loading:true, parcel:null, events:null, names:{} };
  build("drawer-loading", () => vDrawer());
  S.drawer = { barcode:full.barcode, loading:false, parcel:full, events:null, names:{} };
  build("drawer-history-pending", () => vDrawer());
  S.drawer = { barcode:full.barcode, loading:false, parcel:full, events:[], names:{} };
  build("drawer-no-history", () => vDrawer());

  // the edit form must offer each role only what it may change
  document.body.children = [];
  S.me = { id:"u1", name:"Ali Nasser", role:"scanner", active:true };
  try {
    askEdit(full);
    out["edit-scanner"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["edit-scanner"] = { ok:false, err:e && e.message }; }
  document.body.children = [];
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  try {
    askEdit(full);
    out["edit-office"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["edit-office"] = { ok:false, err:e && e.message }; }
  document.body.children = [];
  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  try {
    askDeleteParcel(full);
    out["delete-dialog"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["delete-dialog"] = { ok:false, err:e && e.message }; }
  S.drawer = null;

  // shipping — the other business line, office and admin only
  S.tab = "shipping";
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  S.shipStats = {
    total_all:46, shipments:46, sea:19, air:27,
    billed:8257.14, collected:567.85, outstanding:7689.29,
    unpaid_count:43, undelivered:42, clients:31, containers:23,
  };
  S.shipQ = ""; S.shipFilters = { mode:"", paid:"" };
  S.ships = [
    { ship_num:3420, code:"SALAM-SAMI KHOURY", client:"SAMI KHOURY", mode:"sea",
      container:"C-031", boxes:1, goods:null, weight_kg:0, volume_cbm:0.0554,
      price:450, total:24.93, paid_amount:0,
      raised_at:"2026-10-31", arrived_at:"2026-10-31", delivered_at:null, paid_at:null },
    { ship_num:3409, code:"SALAM-NADA SALEM", client:"NADA SALEM", mode:"air",
      container:"A-098", boxes:33, goods:"UTENSILS", weight_kg:3.8, volume_cbm:0,
      price:10.5, total:39.9, paid_amount:39.9,
      raised_at:"2026-10-29", arrived_at:"2026-10-29",
      delivered_at:"2026-10-30", paid_at:"2026-10-30" },
  ];
  build("shipping", () => vShipping());
  S.shipFilters = { mode:"sea", paid:"unpaid" };
  build("shipping-filtered", () => vShipping());
  S.shipFilters = { mode:"", paid:"" };
  S.ships = []; build("shipping-none", () => vShipping());
  S.ships = null; build("shipping-loading", () => vShipping());
  S.shipStats = null; build("shipping-adding-up", () => vShipping());

  // a scanner must not be offered it at all
  S.me = { id:"u1", name:"Ali Nasser", role:"scanner", active:true };
  out["tabs-scanner-shipping"] = { ok:true,
    text: visibleTabs().map(t => t.label).join(" "), cls:"" };
  S.me = { id:"u4", name:"Desk", role:"call_center", active:true };
  out["tabs-callcenter"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  out["tabs-office"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };
  S.ships = null; S.shipStats = null;

  // setup — office may look, only an admin may change
  S.tab = "setup";
  S.cfg = {
    whName:"ChinaHub Warehouse", whSub:"China → Lebanon · consolidation hub",
    freeDays:14, longStayDays:90, lbpRate:89500, cnyPerUsd:6.1,
    rateMode:"cbm", ratePerCbm:450, ratePerKg:14.5,
    lanes:[
      { label:"Air · Hong Kong", match:"Air Cargo Hk", basis:"kg", price:16.5 },
      { label:"Air · Guangzhou", match:"Air Cargo LB", basis:"kg", price:14.5 },
      { label:"Clothes", match:"Clothes", basis:"cbm", price:850 },
    ],
  };
  S.cfgDraft = null;
  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  build("setup-admin", () => vSetup());
  S.cfgDraft = null;
  S.laneCover = { 0:854, 1:4535, 2:0, "-1":184 };
  build("setup-with-coverage", () => vSetup());
  S.cfgDraft = null; S.laneCover = null;
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  build("setup-office", () => vSetup());
  S.cfgDraft = null;
  S.cfg = null; build("setup-loading", () => vSetup());
  S.cfg = { lanes:[] };
  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  S.cfgDraft = null;

  // the zone dialog has to build, new and existing
  document.body.children = [];
  try {
    askZone(null);
    askZone({ code:"C", label:"Zone C", kind:"shelf", racks:22, levels:5,
              capacity:0, note:null, sort:3 });
    out["zone-dialogs"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["zone-dialogs"] = { ok:false, err:e && e.message }; }

  // a scanner must not be offered Money at all
  S.me = { id:"u1", name:"Ali Nasser", role:"scanner", active:true };
  out["tabs-scanner"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  out["tabs-office"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };
  S.me = { id:"u3", name:"Hadi", role:"admin", active:true };
  out["tabs-admin"] = { ok:true, text: visibleTabs().map(t => t.label).join(" "), cls:"" };

  // selecting several at once
  S.tab = "stock"; S.rows = rows; S.total = 2; S.stats = summary;
  S.me = { id:"u2", name:"Office", role:"office", active:true };
  S.sel = new Set([rows[0].barcode]);
  build("stock-one-selected", () => vStock());
  S.total = 1605;                      /* more matches than are on screen */
  build("stock-can-select-all", () => vStock());
  S.total = 2;
  S.me = { id:"u1", name:"Ali Nasser", role:"scanner", active:true };
  build("stock-selected-scanner", () => vStock());
  S.me = { id:"u2", name:"Office", role:"office", active:true };

  document.body.children = [];
  try {
    askBulkMove("shelved");
    out["bulk-shelve-dialog"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["bulk-shelve-dialog"] = { ok:false, err:e && e.message }; }
  document.body.children = [];
  try {
    askBulkMove("delivered");
    out["bulk-deliver-dialog"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["bulk-deliver-dialog"] = { ok:false, err:e && e.message }; }
  document.body.children = [];
  try {
    askBulkMove("at_branch");
    out["bulk-branch-dialog"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["bulk-branch-dialog"] = { ok:false, err:e && e.message }; }
  document.body.children = [];
  try {
    askBulkPaid(true);
    out["bulk-paid-dialog"] = { ok:true,
      text: document.body.children.map(c => c.textContent).join(" "), cls:"" };
  } catch (e) { out["bulk-paid-dialog"] = { ok:false, err:e && e.message }; }
  S.sel = new Set();

  // The import must not let a wrong Barcode column invent parcels. This is
  // what thirty-four shelf labels looked like on their way in.
  S.cfg = { cnyPerUsd: 6.1 };
  S.imp = { fileName:"scan.csv", kind:"export",
    headers:["barcode","shelf","scanned at"],
    data:[["YT7600000000002","C20-01-05","2026-10-30T12:31:23Z"],
          ["430000000000001","C20-01-05","2026-10-30T12:31:17Z"],
          ["770000000000001","C-04-03","2026-10-30T12:31:52Z"]],
    map:{ barcode:1 }, status:"received", zone:"" };
  const wrong = buildImportRows();
  out["import-wrong-column"] = { ok:true,
    text: JSON.stringify({ distinct: wrong.distinct, bad: wrong.notParcelNos.length,
                           bare: wrong.bare }), cls:"" };
  S.impPreview = { total:wrong.rows.length, newOnes:wrong.rows.length, existing:0,
    noBarcode:wrong.noBarcode, dupes:wrong.dupes, emptyCols:wrong.emptyCols,
    notParcelNos:wrong.notParcelNos, bare:wrong.bare, distinct:wrong.distinct };
  build("import-blocked", () => importSection());

  // and the right column must sail through
  S.imp.map = { barcode:0 };
  const right = buildImportRows();
  out["import-right-column"] = { ok:true,
    text: JSON.stringify({ distinct: right.distinct, bad: right.notParcelNos.length }), cls:"" };
  S.imp = null; S.impPreview = null;

  // zones
  S.tab = "zones";
  S.zoneStats = [
    { code:"A", label:"Zone A", kind:"shelf", racks:10, levels:5, capacity:0,
      note:"A1-01-01 to A10-01-05", sort:1, parcels:412, locations_used:44 },
    { code:"C", label:"Zone C", kind:"shelf", racks:22, levels:5, capacity:0,
      note:null, sort:3, parcels:489, locations_used:99 },
    { code:"SHIP", label:"Shipping department", kind:"staging", racks:null, levels:null,
      capacity:300, note:"Waiting to be put on shelves", sort:6, parcels:1884, locations_used:0 },
    { code:"HAMRA", label:"Hamra office", kind:"branch", racks:null, levels:null,
      capacity:0, note:"Customers collect and pay here", sort:10,
      parcels:12, locations_used:0 },
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
/* The name, in the one place that cannot read it from the database. */
expect("signIn", "BAGHDEDI Warehouse System");
/* The ChinaHub logo replaced the initials badge. */
expect("signIn", "logo-full");
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
expect("money", "¥240,004.19");   /* 39,344.95 × 6.1 */
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

expect("drawer-office", "Karim Nassif");
expect("drawer-office", "C18-01-01");
expect("drawer-office", "$25.01");
expect("drawer-office", "Air · Guangzhou");
expect("drawer-office", "$14.50 per kg");
expect("drawer-office", "Mark paid");
expect("drawer-office", "Ali Nasser");
expect("drawer-office", "before sign-in");   /* the import line has no actor */
expect("drawer-office", "here 107 days");
expect("drawer-admin", "Delete");
expect("drawer-no-history", "Nothing recorded yet");
expect("drawer-scanner", "C18-01-01");
expect("edit-scanner", "Description");
expect("edit-office", "Charge (USD)");
expect("delete-dialog", "whole history go for good");

/* A scanner's drawer must carry no money at all, and offer no payment. */
const dsc = (out["drawer-scanner"] || {}).text || "";
for (const bad of ["$", "25.01", "152.55", "Mark paid", "Payment", "Declared"])
  if (dsc.includes(bad)) {
    fail++; console.log("  FAIL  drawer-scanner shows " + JSON.stringify(bad));
  } else pass++;

/* And the edit form must not offer a scanner a field the database refuses. */
const esc = (out["edit-scanner"] || {}).text || "";
for (const bad of ["Charge (USD)", "Customer", "Phone", "Client number", "Declared"])
  if (esc.includes(bad)) {
    fail++; console.log("  FAIL  edit-scanner offers " + JSON.stringify(bad));
  } else pass++;
/* while still offering what it may fix */
for (const good of ["Description", "Box size", "Weight (kg)", "Notes"])
  if (!esc.includes(good)) {
    fail++; console.log("  FAIL  edit-scanner is missing " + JSON.stringify(good));
  } else pass++;

/* Admin must not be offered Delete on someone else's screen by accident:
   only the drawer's own footer has it, and only for an admin. */
const dof = (out["drawer-office"] || {}).text || "";
if (/\bDelete\b/.test(dof)) {
  fail++; console.log("  FAIL  office is offered Delete in the drawer");
} else pass++;

expect("setup-admin", "Price per lane");
expect("setup-admin", "Free storage days");
expect("setup-admin", "Save settings");
expect("setup-with-coverage", "184 parcels match no lane at all");
expect("setup-office", "You can see these but not change them");
expect("zone-dialogs", "Add a zone");
expect("zone-dialogs", "cannot change");

/* Office may read the rates but every control must be disabled, and the
   screen must not offer a Discard that would imply it could save. */
const offi = out["setup-office"];
if (offi && offi.ok && /Discard changes/.test(offi.text)) {
  fail++; console.log("  FAIL  office is offered Discard changes");
} else pass++;

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

/* ------------------------------------------------------- the search box ---
 * Building a view proves nothing about the query behind it. A search column
 * left out of the `or(...)` list looks perfectly healthy on screen and simply
 * finds nothing — which is exactly how client numbers went missing. So the
 * columns the box searches are read out of the source and checked against the
 * columns its own placeholder promises.
 */
const orBlock = (mod.match(/qy\.or\(\[([\s\S]*?)\]\.join/) || [])[1] || "";
const searched = [...orBlock.matchAll(/"([a-z_]+)\.ilike\./g)].map(m => m[1]);
/* Stock's own search box: the placeholder inside stockFilters(), not the
   first search box in the file (other sections have their own). */
const stockFiltersSrc = (mod.match(/function stockFilters\(\)[\s\S]*?\n}\n/) || [""])[0];
const placeholder = (stockFiltersSrc.match(/q\.placeholder\s*=\s*"([^"]*)"/) || [])[1] || "";

const PROMISED = {
  barcode: "Barcode", client_id: "client number", customer: "customer",
  phone: "phone", shelf: "shelf", shipment: "shipment",
};
for (const [col, word] of Object.entries(PROMISED)) {
  if (!searched.includes(col)) {
    fail++; console.log("  FAIL  the search does not cover " + col);
  } else pass++;
  if (!placeholder.toLowerCase().includes(word.toLowerCase())) {
    fail++; console.log("  FAIL  the placeholder does not mention " + word);
  } else pass++;
}
/* And anything searched should be something the rows actually carry. */
const stockSelect = (mod.match(/const STOCK_COLS\s*=\s*\n?\s*"([^"]+)"/) || [])[1] || "";
if (!stockSelect) { fail++; console.log("  FAIL  could not find STOCK_COLS to check against"); }
for (const col of searched)
  if (!stockSelect.split(",").includes(col)) {
    fail++; console.log("  FAIL  " + col + " is searched but never fetched, so a match is invisible");
  } else pass++;

/* ------------------------------------------------------------ the tiles ---
 * The tiles sit above the list and must describe it. They were counting the
 * whole warehouse whatever was filtered, which no rendered view can reveal —
 * so the call is checked for the filters it is supposed to carry, and every
 * place that changes a filter is checked for refreshing them.
 */
const statsCall = (mod.match(/rpc\("stock_summary",\s*\{([\s\S]*?)\}\)/) || [])[1] || "";
for (const p of ["p_search", "p_zone", "p_client", "p_status", "p_paid", "p_here"])
  if (!statsCall.includes(p)) {
    fail++; console.log("  FAIL  the tiles are counted without " + p);
  } else pass++;

/* Changing a filter has to refresh both; turning a page must not. */
const applyBody = (mod.match(/function applyFilters\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || "";
for (const call of ["loadStats()", "loadStock()"])
  if (!applyBody.includes(call)) {
    fail++; console.log("  FAIL  applyFilters does not call " + call);
  } else pass++;
/* Any filter change that still calls loadStock on its own leaves stale tiles. */
const strays = [...mod.matchAll(/S\.filters = [^\n]*\n\s*(?:S\.page = 0;\s*)?loadStock\(\);/g)];
if (strays.length) {
  fail++;
  console.log("  FAIL  " + strays.length + " filter change(s) reload the list but not the tiles");
} else pass++;

/* Shelf labels in the barcode column: every one flagged, nothing allowed in. */
expect("import-wrong-column", '"distinct":2,"bad":2,"bare":3');
expect("import-blocked", "do not look like parcel numbers");
expect("import-blocked", "Fix the Barcode column first");
expect("import-blocked", "load it on the Scan tab instead");
expect("import-right-column", '"distinct":3,"bad":0');

/* The shipping line: its own figures, and never a scanner's business. */
expect("shipping", "By sea");
expect("shipping", "By air");
expect("shipping", "charged per CBM");
expect("shipping", "charged per kilo");
expect("shipping", "$7,689.29");
expect("shipping", "SAMI KHOURY");
expect("shipping", "C-031");
expect("shipping", "0.055 CBM × $450.00/CBM");
expect("shipping", "3.8 kg × $10.50/kg");
expect("shipping", "Mark paid");
expect("shipping", "not delivered");
expect("shipping-filtered", "Clear");
expect("shipping-none", "Nothing matches");
if (/Shipping/.test((out["tabs-scanner-shipping"] || {}).text || "")) {
  fail++; console.log("  FAIL  a scanner is offered the Shipping tab");
} else pass++;

/* The branch office, everywhere it has to appear. */
expect("scan-to-branch", "Going to");
expect("scan-to-branch", "Hamra office");
expect("scan-to-branch-none", "No branch office set up yet");
expect("bulk-branch-dialog", "Which branch");
expect("bulk-branch-dialog", "This clears their shelf");
expect("stock-one-selected", "→ Hamra office");
expect("drawer-at-branch", "At a branch");
expect("zones", "Hamra office");
expect("zones", "Branch offices");
expect("zone-dialogs", "Branch office");
expect("bulk-paid-dialog", "Hamra office");

expect("stock-one-selected", "1 selected");
expect("stock-one-selected", "Mark paid");
expect("stock-one-selected", "→ Waseet");
expect("stock-one-selected", "Export");
expect("stock-can-select-all", "Select all 1,605 matching");
expect("bulk-shelve-dialog", "Shelf");
expect("bulk-deliver-dialog", "This clears their shelf");
expect("bulk-paid-dialog", "How did they pay?");

/* A scanner may move parcels in bulk but must not be offered the money. */
const bsc = (out["stock-selected-scanner"] || {}).text || "";
/* Exporting is for the office and the admin only. */
for (const bad of ["Mark paid", "Mark unpaid", "Export"])
  if (bsc.includes(bad)) {
    fail++; console.log("  FAIL  a scanner is offered " + JSON.stringify(bad) + " in bulk");
  } else pass++;
for (const good of ["→ On a shelf", "→ Delivered"])
  if (!bsc.includes(good)) {
    fail++; console.log("  FAIL  a scanner is missing " + JSON.stringify(good));
  } else pass++;

/* Sales orders: one client's parcels with paid and unpaid totals. */
expect("sales-office", "Sales Orders");
expect("sales-office", "$23.00");
expect("sales-office", "$5.50");
expect("sales-office", "$28.50");
expect("sales-office", "Export");
expect("sales-office", "Shipped Oct 2026");
expect("sales-paid", "YT7000000000002");
if (((out["sales-paid"] || {}).text || "").includes("YT7000000000001")) {
  fail++; console.log("  FAIL  the paid filter still lists an unpaid parcel");
} else pass++;
expect("tabs-office", "Sales Orders");
for (const v of ["tabs-scanner-shipping", "tabs-callcenter"])
  if (((out[v] || {}).text || "").includes("Sales Orders")) {
    fail++; console.log("  FAIL  " + v + " is offered Sales Orders");
  } else pass++;

/* Every section's Export is for the office and the admin, nobody else. */
expect("stock-office", "Export list");
expect("scan-office", "Export");
expect("scan-admin", "Export");
for (const v of ["stock-scanner", "scan-with-feed", "scan-callcenter"])
  if (((out[v] || {}).text || "").includes("Export")) {
    fail++; console.log("  FAIL  " + v + " offers Export");
  } else pass++;

/* Selection is by barcode, so paging and reloading cannot scramble it. */
if (/sel: new Set\(\)/.test(mod)) pass++;
else { fail++; console.log("  FAIL  the selection is not a Set of barcodes"); }

expect("stock-one-client", "of 8,232 in the warehouse");
expect("stock-one-client", "1,605");
expect("stock-one-client", "client 1000001");

/* "This client's parcels" must be an exact filter, not a substring search:
   a short client number is also a substring of hundreds of barcodes. */
if (/sh\.onclick[\s\S]{0,200}?S\.q\s*=\s*c\.client_id/.test(mod)) {
  fail++; console.log("  FAIL  the Parcels button searches by text instead of filtering exactly");
} else pass++;
if (/if \(f\.client\) qy = qy\.eq\("client_id", f\.client\)/.test(mod)) pass++;
else { fail++; console.log("  FAIL  there is no exact client filter"); }

console.log("\n" + Object.keys(out).length + " views built, " + pass + " checks passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
