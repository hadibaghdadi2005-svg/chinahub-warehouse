/* BAGHDEDI warehouse app — everything the page does. Loaded by index.html
   as a module; the tests read this file directly. */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

/* The project and its publishable key. The key is meant to sit in client code:
   on its own it opens nothing, because every table is behind row-level
   security and an account with no profile has no role and therefore no access. */
const SUPABASE_URL = "https://llarspjcyvqzylxjxlld.supabase.co";
const SUPABASE_KEY = "sb_publishable_OKETaCQWF5_VvMj2Wa3cMw_jpOA3DBa";

/* Stamped by publish-pages.js on the way out. Shown on the sign-in card and
   in Setup, so "which version am I actually running" has an answer — without
   one, a fixed bug and a cached copy look exactly the same. */
const BUILD = "dev";
/* Which version is this? The website says when app.js was last
   published (its Last-Modified date), so every phone can show the same
   answer without a build step. */
const versionLabel = () => BUILD !== "dev" ? BUILD : (S.builtAt || "checking…");
async function loadBuiltAt() {
  try {
    const r = await fetch(location.pathname.replace(/[^/]*$/, "") + "app.js", { method: "HEAD", cache: "no-store" });
    const lm = r.headers.get("last-modified");
    S.builtAt = lm ? "of " + new Date(lm).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "local copy";
  } catch (_) { S.builtAt = "offline copy"; }
  render();
}

/* The name has to be here as well as in the database, because the sign-in
   screen, the browser tab and the installed app all need it before anyone has
   signed in to read a setting. Once signed in, the stored name wins, so a
   rename in Setup shows everywhere inside the app without waiting for this
   file to be published again. */
const BRAND = "BAGHDEDI Warehouse System";
const BRAND_SUB = "China → Lebanon · consolidation hub";

/* The corner badge, from whatever the warehouse is called — so a rename never
   strands old initials beside a new name. */
const initials = name => String(name || BRAND)
  .split(/\s+/).filter(Boolean).slice(0, 2)
  .map(w => w[0].toUpperCase()).join("") || "W";

const whName = () => (S.brand && S.brand.name) || BRAND;
const whSub = () => (S.brand && S.brand.subtitle) || BRAND_SUB;

const ROLES = {
  scanner:     { label: "Scanner",     blurb: "Shelves and looks up parcels. Never sees a charge." },
  call_center: { label: "Call Center", blurb: "Sees stock and costs for searched clients. No totals." },
  office:      { label: "Office",      blurb: "Prices parcels and takes payment." },
  admin:       { label: "Admin",       blurb: "Everything, plus staff accounts and rates." },
};
const STATUS = {
  expected:  "On the way",
  received:  "In the warehouse",
  shelved:   "On a shelf",
  at_branch: "At a branch",
  released:  "Waseet",
  delivered: "Delivered",
};
const ORDER = ["expected", "received", "shelved", "at_branch", "released", "delivered"];

/* How money actually comes in. "Hamra office" is a place as much as a method,
   which is the point: the office needs to know where a payment was taken, not
   only that it was. */
const PAY_METHODS = ["CASH", "Hamra office", "Cash on delivery paid",
  "WhishPay", "MontyPay", "Balance Pay", "Cybersource"];

/* A branch is somewhere that is not this warehouse — the Hamra office to
   begin with. While there is only one, it is named everywhere rather than
   called "a branch", because nobody in the warehouse says "a branch". */
const branchZones = () => S.zones.filter(z => z.kind === "branch");
const theBranch = () => (branchZones().length === 1 ? branchZones()[0] : null);
const branchLabel = () => {
  const b = theBranch();
  return b ? (b.label || b.code) : "a branch";
};

/* What a scan does. `to` is the status it moves a parcel into; lookup moves
   nothing and is the safe one to leave the gun sitting in. */
const MODES = {
  receive: { label: "Receive", sub: "arrived at the hub",  to: "received",  verb: "Received" },
  shelve:  { label: "Put away", sub: "onto a shelf",       to: "shelved",   verb: "Shelved" },
  zone:    { label: "To zone",  sub: "scan zone then parcels", to: "shelved", verb: "Zoned" },
  branch:  { label: "To a branch", sub: "for collection",  to: "at_branch", verb: "Sent to" },
  release: { label: "Waseet", sub: "cash on delivery",      to: "released",  verb: "Sent to Waseet" },
  deliver: { label: "Deliver", sub: "to the customer",     to: "delivered", verb: "Delivered" },
  lookup:  { label: "Look up", sub: "changes nothing",     to: null,        verb: "Found" },
};
const SCANFEED_MAX = 14;

const S = {
  sb: null,
  session: null,
  me: null,            /* own profiles row, or null when there is none */
  tab: "scan",
  staff: [],
  busy: false,

  /* stock */
  q: "",
  rows: null,          /* the page on screen, null before the first load */
  searching: false,
  filters: { status: "", zone: "", paid: "" },
  stockSort: "",
  page: 0,
  pageSize: 50,
  total: 0,
  stats: null,         /* the tiles, counted by the database */
  zoneStats: null,

  /* money — office and admin only */
  money: null,
  cfg: null,           /* rates and lane prices, readable only with the money */
  monthlyRates: null,  /* {month: cny_per_usd} from monthly_rates table */

  /* sales orders (one wholesale client) */
  soData: null, soLoading: false, soQ: "", soStatus: "", soPay: "", soMonth: "",
  soSort: "new", soPage: 0,
  customers: null,
  custSearch: "",
  custOwing: true,
  custPage: 0,
  custPageSize: 50,
  custTotal: 0,

  /* summary */
  summaryData: null,
  summaryDate: "",

  /* waseet */
  waseetData: null,
  waseetShips: null,
  waseetDate: "",
  waseetSort: "desc",
  waseetSel: new Set(),
  waseetOpen: new Set(),
  waseetQ: "",

  /* money date filter */
  moneyDate: "",

  /* shipping date filter + sort */
  shipDate: "",
  shipSort: "",
  shipSel: new Set(),

  /* labels */
  labelTab: "zones",
  labelShips: null,
  selectedZones: new Set(),
  selectedShips: new Set(),

  /* call center */
  ccData: null,        /* [{client_id, parcels: [...], totalCost}] grouped */
  ccOpen: new Set(),   /* expanded client IDs */
  ccSort: "most",      /* "most" | "least" */
  ccStatus: "",        /* "" = all, or a status value */
  ccQ: "",
  ccLoading: false,

  /* setup */
  brand: null,         /* what the warehouse is called, per the database */
  cfgDraft: null,      /* edits in progress; nothing is written until Save */
  cfgSaving: false,
  drawer: null,        /* the parcel currently open over everything */

  /* selecting several at once. Held as barcodes, so it survives paging. */
  sel: new Set(),
  lastTick: null,
  bulkBusy: false,
  selAllBusy: false,

  /* import */
  imp: null,           /* the file being brought in: headers, rows, mapping */
  impBusy: false, impChecking: false, impRunning: false,
  impDone: 0, impPreview: null, impResult: null, impError: "",
  scanRunning: false, scanDone: 0, scanResult: null,
  scanRecon: null, scanReconRunning: false, scanReconDone: false,

  /* shipping — the other business line */
  ships: null, shipStats: null, shipQ: "",
  shipFilters: { mode: "", paid: "" },
  shipRunning: false, shipDone: 0, shipResult: null,
  laneCover: null,     /* how many parcels each lane would take */
  coverBusy: false,

  /* scan station */
  zones: [],
  mode: "lookup",
  dest: { zone: "", shelf: "" },   /* where "put away" is currently filing to */
  scanZone: "",                    /* zone-scan mode: the zone scanned barcodes go to */
  recvZone: "SHIP",                /* where a receive scan lands */
  branchZone: "",                  /* which branch a branch scan goes to */
  scanFeed: [],
  undo: null,                      /* the last move, so one misfire is cheap */
  beep: true,
  scanBusy: false,
};

/* ------------------------------------------------------------- helpers ---- */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, x) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (x != null) n.textContent = x;
  return n;
};
const sees_money = () => S.me && (S.me.role === "office" || S.me.role === "admin" || S.me.role === "call_center");
const isAdmin = () => S.me && S.me.role === "admin";
const isCallCenter = () => S.me && S.me.role === "call_center";
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf3 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => "$" + nf2.format(Number(n) || 0);
const fmtDate = s => s ? new Date(s).toLocaleDateString([], { day: "2-digit", month: "short", year: "2-digit" }) : "—";

function toast(msg, kind) {
  const t = el("div", "toast" + (kind ? " " + kind : ""), msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), kind === "bad" ? 6000 : 3500);
}

/* Supabase's own wording is fine for a wrong password and unhelpful for the
   rest, so the cases worth explaining get explained. */
function authMessage(err) {
  const m = String(err && err.message || err || "");
  if (/wrong username|invalid login credentials/i.test(m)) return "Wrong username or password.";
  if (/email not confirmed/i.test(m)) return "That account has not been confirmed yet.";
  if (/failed to fetch|networkerror/i.test(m)) return "No connection. Check the network and try again.";
  if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
  return m || "Could not sign in.";
}

function banner(kind, title, body) {
  const b = el("div", "banner" + (kind ? " " + kind : ""));
  const w = el("div");
  w.append(el("b", null, title));
  if (body) w.append(document.createTextNode(body));
  b.append(w);
  return b;
}

function logo() {
  const w = el("div", "logo");
  const img = el("img", "logo-full");
  img.src = "logo.png"; img.alt = "Chinahub.Lb — Think local, ship global";
  const t = el("div");
  t.append(el("div", "logo-t", BRAND));
  t.append(el("div", "logo-s", BRAND_SUB));
  w.append(img, t);
  return w;
}

/* The ChinaHub mark in a small white tile, for the header. */
function logoMark(hop) {
  const m = el("div", "logo-m" + (hop ? " hop" : ""));
  const img = el("img");
  img.src = "logo-mark.png"; img.alt = "ChinaHub";
  m.append(img);
  return m;
}

/* --------------------------------------------------------------- account --- */
/* Everyone's own corner: who they are signed in as, a new password, sign out. */
function openAccount() {
  const scrim = el("div", "scrim");
  const m = el("div", "modal");
  m.append(el("h3", null, "Your account"));
  const me = (S.staff || []).find(p => p.id === S.me.id) || {};
  const card = el("div", "card pad acct");
  const line = (k, v) => { const r = el("div", "acct-row"); r.append(el("span", "li-s", k), el("b", "mono", v || "—")); card.append(r); };
  line("Name", S.me.name);
  line("Username", S.me.username || me.username);
  line("Email", S.session && S.session.user && S.session.user.email);
  line("Role", (ROLES[S.me.role] || {}).label || S.me.role);
  m.append(card);

  const f = el("form");
  f.style.marginTop = "16px";
  f.append(el("div", "sect-t", "Change your password"));
  const err = el("div");
  err.style.marginTop = "10px";
  f.append(err);
  const field = (label, ac) => {
    const l = el("label", "field");
    l.append(el("span", null, label));
    const i = el("input", "inp");
    i.type = "password"; i.required = true; i.autocomplete = ac;
    l.append(i); f.append(l);
    return i;
  };

  const cur = field("Current password", "current-password");
  const nw = field("New password (8 or more characters)", "new-password");
  const again = field("New password again", "new-password");
  const go = el("button", "btn pri wide", "Save new password");
  go.type = "submit";
  f.append(go);
  f.addEventListener("submit", async ev => {
    ev.preventDefault();
    err.textContent = "";
    if (nw.value.length < 8) { err.replaceChildren(banner("bad", "Too short", "Use at least 8 characters.")); return; }
    if (nw.value !== again.value) { err.replaceChildren(banner("bad", "They do not match", "Type the new password the same way twice.")); return; }
    if (nw.value === cur.value) { err.replaceChildren(banner("bad", "That is the same password", "Pick a new one.")); return; }
    go.disabled = true; go.textContent = "Saving…";
    /* Prove the current password first, so a phone left signed in on a shelf
       cannot have its password changed by whoever picks it up. */
    const email = S.session && S.session.user && S.session.user.email;
    const check = await S.sb.auth.signInWithPassword({ email, password: cur.value });
    if (check.error) {
      go.disabled = false; go.textContent = "Save new password";
      err.replaceChildren(banner("bad", "Current password is wrong", "Type the password you signed in with."));
      return;
    }
    const { error } = await S.sb.auth.updateUser({ password: nw.value });
    go.disabled = false; go.textContent = "Save new password";
    if (error) { err.replaceChildren(banner("bad", "Could not change it", error.message)); return; }
    scrim.remove();
    toast("Password changed. Use the new one next time you sign in.", "ok");
  });
  m.append(f);

  const acts = el("div", "row");
  acts.style.marginTop = "14px";
  const out = el("button", "btn dng", "Sign out");
  out.onclick = () => { scrim.remove(); signOut(); };
  const close = el("button", "btn", "Close");
  close.style.marginLeft = "auto";
  close.onclick = () => scrim.remove();
  acts.append(out, close);
  m.append(acts);

  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

/* --------------------------------------------------------------- sign in --- */
function vSignIn() {
  const wrap = el("div", "auth");
  const card = el("form", "auth-card");
  card.append(logo());

  const h = el("h2", null, "Sign in");
  h.style.fontSize = "19px";
  card.append(h);
  const sub = el("p", "sub", "Your warehouse account. Ask Hadi if you do not have one.");
  sub.style.margin = "4px 0 18px";
  card.append(sub);

  const err = el("div");
  card.append(err);

  const f1 = el("label", "field");
  f1.append(el("span", null, "Username or email"));
  const email = el("input", "inp");
  email.type = "text"; email.required = true; email.autocomplete = "username";
  email.autocapitalize = "off"; email.spellcheck = false;
  email.placeholder = "BAGHDEDI";
  f1.append(email);

  const f2 = el("label", "field");
  f2.append(el("span", null, "Password"));
  const pass = el("input", "inp");
  pass.type = "password"; pass.required = true; pass.autocomplete = "current-password";
  f2.append(pass);

  const go = el("button", "btn pri wide", "Sign in");
  go.type = "submit";

  card.append(f1, f2, go);
  const ver = el("div", "sub2", "version " + versionLabel());
  ver.style.cssText = "margin-top:14px;text-align:center";
  card.append(ver);

  card.addEventListener("submit", async ev => {
    ev.preventDefault();
    err.textContent = "";
    go.disabled = true;
    go.textContent = "";
    go.append(el("span", "spin"), document.createTextNode(" Signing in"));
    const { error } = await signInWith(email.value.trim(), pass.value);
    if (error) {
      err.replaceChildren(banner("bad", "Could not sign in", authMessage(error)));
      go.disabled = false;
      go.textContent = "Sign in";
      pass.value = "";
      pass.focus();
      return;
    }
    /* onAuthStateChange picks it up and re-renders. */
  });

  wrap.append(card);
  return wrap;
}

/* A username is turned into a session by the login function, so the sign-in
   page never learns anyone's email address. An email still works as before. */
async function signInWith(login, password) {
  if (login.includes("@")) return S.sb.auth.signInWithPassword({ email: login, password });
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
      body: JSON.stringify({ username: login, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) return { error: { message: j.error || "Wrong username or password." } };
    return S.sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
  } catch (e) {
    return { error: { message: "No connection — check the internet and try again." } };
  }
}

/* An account that exists but has no role yet, or has been switched off. Both
   land here, and from the outside they are the same thing: ask Hadi. */
function vNoAccess() {
  const wrap = el("div", "auth");
  const card = el("div", "auth-card");
  card.append(logo());
  card.append(banner("warn", "This account cannot see the warehouse yet",
    "You are signed in, but nobody has given this account a role. Ask Hadi to set it up, " +
    "then sign in again."));
  const who = el("p", "sub", "Signed in as " + (S.session?.user?.email || "—"));
  who.style.margin = "0 0 14px";
  card.append(who);
  const out = el("button", "btn wide", "Sign out");
  out.onclick = signOut;
  card.append(out);
  wrap.append(card);
  return wrap;
}

async function signOut() {
  await S.sb.auth.signOut();
  S.me = null; S.staff = []; S.rows = null; S.q = ""; S.soData = null;
  render();
}

/* ----------------------------------------------------------------- shell --- */
function shell(view) {
  const frag = document.createDocumentFragment();

  const top = el("header", "top");
  const inr = el("div", "top-in gut");
  /* Only the first render of a section animates it in. */
  const entering = S._shownTab !== S.tab;
  S._shownTab = S.tab;
  if (entering) S._enterAt = Date.now();

  const brand = el("div", "brand");
  brand.append(logoMark(entering));
  const bt = el("div", "brand-tx");
  bt.append(el("div", "logo-t", whName()));
  bt.append(el("div", "logo-s", S.me.name));
  brand.append(bt);

  const who = el("div", "who");
  who.append(roleChip(S.me.role));
  const acc = el("button", "btn sm", "Account");
  acc.onclick = openAccount;
  who.append(acc);

  inr.append(brand, who);
  top.append(inr);

  const tabs = el("nav", "tabs gut");
  const list = visibleTabs();
  for (const t of list) {
    const b = el("button", "tab" + (entering && t.id === S.tab ? " pop" : ""), t.label);
    if (t.id === S.tab) b.setAttribute("aria-current", "page");
    b.onclick = () => {
      if (t.id === S.tab) return;
      const from = list.findIndex(x => x.id === S.tab);
      S.tab = t.id;
      S.sel.clear(); S.lastTick = null;
      render();
      flyBetween(list.findIndex(x => x.id === t.id) >= from ? 1 : -1);
      /* Load on arrival, so a tab is never opened onto stale counts. */
      if (t.id === "stock") {
        if (isCallCenter()) { if (!S.ccData) loadCallCenterStock(); }
        else { if (!S.stats) loadStats(); if (!S.rows) loadStock(); }
      }
      if (t.id === "zones" && !S.zoneStats) loadZoneStats();
      /* Always fresh: a payment taken elsewhere must show here straight away. */
      if (t.id === "sales") { loadSales(); if (!S.stats) loadStats(); if (!S.money) loadMoney(); }
      if (t.id === "money") {
        if (!S.money) loadMoney();
        if (!S.cfg) loadCfg();
        if (!S.customers) loadCustomers();
      }
      if (t.id === "setup" && !S.cfg) loadCfg();
      if (t.id === "shipping") {
        if (!S.ships) loadShipments();
        if (!S.shipStats) loadShipStats();
      }
      if (t.id === "labels") {
        if (!S.labelShips) loadLabelShipments();
      }
      if (t.id === "summary") {
        if (!S.money) loadMoney();
        if (!S.shipStats) loadShipStats();
        if (!S.summaryData) loadSummary();
      }
      if (t.id === "waseet") {
        if (!S.waseetData) loadWaseet();
      }
    };
    tabs.append(b);
  }
  top.append(tabs);

  const main = el("main", "gut" + (entering ? " enter" : ""));
  main.append(view);
  frag.append(top, main);
  return frag;
}

/* A plane crosses the screen on a curve, trailing a dotted contrail, and the
   new section is uncovered behind it. Nothing waits on it: the section is
   already live underneath, so a scan typed straight away still lands. */
const PLANE_D = "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z";
let flight = null;
function flyBetween(dir) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (flight) flight.end(true);
  const W = innerWidth, H = innerHeight;
  const top = document.querySelector(".top");
  const base = Math.min(H * 0.55, (top ? top.getBoundingClientRect().bottom : 90) + 150);
  const P0 = {x: dir > 0 ? -70 : W + 70, y: base + 50};
  const P1 = {x: W / 2, y: base - 120};
  const P2 = {x: dir > 0 ? W + 70 : -70, y: base + 50};
  const at = (e) => ({
    x: (1 - e) * (1 - e) * P0.x + 2 * (1 - e) * e * P1.x + e * e * P2.x,
    y: (1 - e) * (1 - e) * P0.y + 2 * (1 - e) * e * P1.y + e * e * P2.y,
  });
  const NS = "http://www.w3.org/2000/svg";
  const box = document.createElement("div");
  box.className = "flight";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  const clipId = "fl" + Date.now();
  const defs = document.createElementNS(NS, "defs");
  const clip = document.createElementNS(NS, "clipPath");
  clip.id = clipId;
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("y", "0"); rect.setAttribute("height", String(H)); rect.setAttribute("width", "0");
  clip.append(rect); defs.append(clip); svg.append(defs);
  const trail = document.createElementNS(NS, "path");
  trail.setAttribute("class", "trail");
  trail.setAttribute("d", `M${P0.x} ${P0.y} Q${P1.x} ${P1.y} ${P2.x} ${P2.y}`);
  trail.setAttribute("clip-path", `url(#${clipId})`);
  const plane = document.createElementNS(NS, "g");
  plane.setAttribute("class", "plane");
  const pp = document.createElementNS(NS, "path");
  pp.setAttribute("d", PLANE_D); pp.setAttribute("fill", "currentColor");
  plane.append(pp);
  svg.append(trail, plane);
  box.append(svg);
  document.body.append(box);

  const D = 820, t0 = performance.now();
  const ease = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  let raf = 0, done = false;
  const reveal = (x) => {
    const m = document.querySelector("main");
    if (!m) return;
    const r = m.getBoundingClientRect();
    m.style.clipPath = dir > 0
      ? `inset(0 ${Math.max(0, r.right - x)}px 0 0)`
      : `inset(0 0 0 ${Math.max(0, x - r.left)}px)`;
  };
  const end = (now) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    const m = document.querySelector("main");
    if (m) m.style.clipPath = "";
    if (now) box.remove();
    else { box.classList.add("out"); setTimeout(() => box.remove(), 380); }
    if (flight && flight.box === box) flight = null;
  };
  flight = {box, end};
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / D), e = ease(p);
    const a = at(e), b = at(Math.min(1, e + 0.01));
    const deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90;
    plane.setAttribute("transform", `translate(${a.x} ${a.y}) rotate(${deg}) scale(2.1) translate(-12 -12)`);
    if (dir > 0) { rect.setAttribute("x", "0"); rect.setAttribute("width", String(Math.max(0, a.x))); }
    else { rect.setAttribute("x", String(a.x)); rect.setAttribute("width", String(Math.max(0, W - a.x))); }
    reveal(a.x);
    if (p < 1) raf = requestAnimationFrame(frame); else end(false);
  };
  raf = requestAnimationFrame(frame);
}

function visibleTabs() {
  if (isCallCenter()) return [
    { id: "stock", label: "Stock" },
  ];
  const t = [
    { id: "scan", label: "Scan" },
    { id: "stock", label: "Stock" },
    { id: "zones", label: "Zones" },
  ];
  if (sees_money()) t.push({ id: "money", label: "Money" });
  if (canExport()) t.push({ id: "sales", label: "Sales Orders" });
  if (sees_money()) t.push({ id: "shipping", label: "Shipping" });
  if (sees_money()) t.push({ id: "summary", label: "Summary" });
  if (sees_money()) t.push({ id: "waseet", label: "Waseet" });
  if (sees_money()) t.push({ id: "setup", label: "Setup" });
  t.push({ id: "labels", label: "Labels" });
  if (isAdmin()) t.push({ id: "staff", label: "Staff" });
  return t;
}

function roleChip(role) {
  return el("span", "chip " + role, (ROLES[role] || {}).label || role);
}

/* ---------------------------------------------------------- scan station --- */
/* A gun types a barcode and presses Enter, so the whole station is one text
   field that must never lose focus, and a sound for each outcome — nobody
   watches the screen while putting a parcel on a shelf. */

const normBc = s => String(s || "").trim().replace(/\s+/g, " ");

/* While putting away, a code that is not a parcel is a shelf label. Shelves
   carry whatever barcodes the warehouse printed, so they are recognised by
   what they are NOT — a dashboard parcel number — rather than by a pattern. */
function looksLikeParcelNo(code) {
  const s = String(code || "");
  if (s.length < 11) return false;
  return (s.replace(/\D/g, "").length / s.length) > 0.7;
}

/* A shelf code opens with its zone letter and rack number — A1-01-03 is zone
   A, rack 1 — so match the leading zone code, longest first. */
function zoneForShelf(code) {
  const first = String(code || "").toUpperCase().split(/[-/_. ]/)[0];
  const z = S.zones
    .filter(x => x.kind === "shelf" && x.code)
    .sort((a, b) => b.code.length - a.code.length)
    .find(x => first.startsWith(x.code.toUpperCase()));
  return z ? z.code : "";
}

/* Shelf codes run {zone}{rack}-01-{level}. Catch a misread pointing at a rack
   or level the zone does not have, rather than filing parcels onto a shelf
   that is not there. Codes in any other shape are taken as given. */
function shelfOutOfRange(code) {
  const m = String(code || "").toUpperCase().match(/^([A-Z]+)(\d+)-(\d+)-(\d+)$/);
  if (!m) return "";
  const z = S.zones.find(x => (x.code || "").toUpperCase() === m[1]);
  if (!z || z.kind !== "shelf") return "";
  const racks = Number(z.racks) || 0, levels = Number(z.levels) || 0;
  const rack = +m[2], level = +m[4];
  if (racks && (rack < 1 || rack > racks))
    return "Zone " + z.code + " has racks 1–" + racks + ", not " + rack + " — rescan the shelf label";
  if (levels && (level < 1 || level > levels))
    return "Zone " + z.code + " has levels 1–" + levels + ", not " + level + " — rescan the shelf label";
  return "";
}

let AC = null;
function ping(ok) {
  if (!S.beep) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = "square";
    o.frequency.value = ok ? 1180 : 360;
    o.connect(g); g.connect(AC.destination);
    const t = AC.currentTime;
    g.gain.setValueAtTime(.05, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + (ok ? .09 : .22));
    o.start(t); o.stop(t + (ok ? .1 : .24));
  } catch (_) {}
}

const focusScan = () => { const i = $("#scanin"); if (i) { i.focus(); i.select?.(); } };

function feedPush(kind, bc, msg, undoable) {
  S.scanFeed = [{ kind, bc, msg, t: Date.now(), undoable: !!undoable }, ...S.scanFeed]
    .slice(0, SCANFEED_MAX);
  /* The feed only keeps the last few; the tally counts the whole session. */
  S.scanTally = S.scanTally || { ok: 0, warn: 0, bad: 0 };
  S.scanTally[kind === "ok" ? "ok" : kind === "warn" ? "warn" : "bad"]++;
}

/* A small copy button beside a barcode. It copies without opening the row it
   sits in, and turns into a tick for a moment so you know it worked. */
const COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/>' +
  '<path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const TICK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
function copyBtn(text) {
  const b = el("button", "copy");
  b.type = "button";
  b.title = "Copy " + text;
  b.setAttribute("aria-label", "Copy " + text);
  b.innerHTML = COPY_SVG;
  b.onclick = async ev => {
    ev.stopPropagation(); ev.preventDefault();
    let ok = false;
    try { await navigator.clipboard.writeText(String(text)); ok = true; } catch (_) {
      /* Older browsers and plain http: copy through a hidden text box. */
      try {
        const t = document.createElement("textarea");
        t.value = String(text); t.style.cssText = "position:fixed;opacity:0";
        document.body.append(t); t.select(); ok = document.execCommand("copy"); t.remove();
      } catch (_) {}
    }
    if (!ok) { toast("Could not copy", "bad"); return; }
    b.classList.add("done"); b.innerHTML = TICK_SVG;
    setTimeout(() => { b.classList.remove("done"); b.innerHTML = COPY_SVG; }, 1200);
  };
  return b;
}

/* Small line icons for the scan modes. Static markup, nothing from a scan. */
const MODE_ICON = {
  receive: '<path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M4 16v4h16v-4"/>',
  shelve:  '<path d="M4 3v18M20 3v18M4 9h16M4 15h16"/>',
  zone:    '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  branch:  '<path d="M3 9l2-5h14l2 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  release: '<path d="M2 6h12v10H2z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  deliver: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  lookup:  '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  barcode: '<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14"/>',
};
function icon(name, cls) {
  const i = el("span", "ico" + (cls ? " " + cls : ""));
  i.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (MODE_ICON[name] || "") + "</svg>";
  return i;
}

/* One parcel, by barcode, with the money masked to whatever the reader is
   allowed. Returns undefined when there is no such parcel. */
async function findParcel(bc) {
  const { data, error } = await S.sb.from("parcels_view")
    .select("barcode,name,customer,status,zone,shelf,shipment,cost,paid")
    .eq("barcode", bc).maybeSingle();
  if (error) throw error;
  return data || undefined;
}

/* Has this shelf been used before? Only needs to know yes or no, so it asks
   for one row rather than counting them. */
async function shelfSeen(code) {
  const { data } = await S.sb.from("parcels_view")
    .select("barcode,zone").eq("shelf", code).limit(1);
  return (data && data[0]) || null;
}

/* The move itself: the parcel's new state, then a line in its history. The
   history is written second on purpose — if it fails, the parcel has still
   moved, and a missing history line is better than a parcel the system thinks
   is somewhere it is not. */
async function moveParcel(p, to, loc, note) {
  const patch = {};
  if (to) patch.status = to;
  if (loc) {
    if (loc.zone != null) patch.zone = loc.zone || null;
    if (loc.shelf != null) patch.shelf = loc.shelf || null;
  }
  const nowIso = new Date().toISOString();
  if (to === "received") patch.received_at = nowIso;
  if (to === "shelved") patch.shelved_at = nowIso;
  if (to === "released") patch.released_at = nowIso;
  if (to === "delivered") patch.delivered_at = nowIso;

  const { error } = await S.sb.from("parcels").update(patch).eq("barcode", p.barcode);
  if (error) throw error;

  const where = patch.shelf || patch.zone || p.shelf || p.zone || null;
  await S.sb.from("parcel_events").insert({
    barcode: p.barcode, at: nowIso, actor: S.me.id,
    from_status: p.status, to_status: to || p.status,
    loc: where, note: note || null,
  });
  return { before: { status: p.status, zone: p.zone, shelf: p.shelf } };
}

async function handleScan(raw) {
  const bc = normBc(raw);
  if (!bc) return;

  /* Recognise printed zone barcodes (ZONE-A, ZONE-RCV, …) in any mode. */
  const zoneMatch = bc.match(/^ZONE-(.+)$/i);
  if (zoneMatch) {
    const code = zoneMatch[1].toUpperCase();
    const zone = S.zones.find(z => z.code.toUpperCase() === code);
    if (!zone) { ping(false); feedPush("bad", bc, "Unknown zone " + code); render(); focusScan(); return; }
    if (S.mode === "zone") {
      S.scanZone = zone.code;
      ping(true); feedPush("ok", bc, "Zone set to " + (zone.label || zone.code) + " — now scan parcels");
    } else if (S.mode === "shelve") {
      S.dest = { zone: zone.code, shelf: "" };
      ping(true); feedPush("ok", bc, "Filing to zone " + zone.code);
    } else if (S.mode === "receive") {
      S.recvZone = zone.code;
      ping(true); feedPush("ok", bc, "Receiving into " + (zone.label || zone.code));
    } else {
      ping(true); feedPush("ok", bc, (zone.label || zone.code) + " — zone barcode (switch to Zone mode to assign parcels)");
    }
    render(); focusScan(); return;
  }

  /* Shipping-client labels (SHIP-123, printed from Labels → Shipments) name a row
     in Shipping. In Zone mode they file that client's goods to the scanned zone. */
  const shipMatch = bc.match(/^SHIP-(\d+)$/i);
  if (shipMatch) {
    S.scanBusy = true; render();
    try {
      const shipNum = Number(shipMatch[1]);
      if (S.mode === "zone" || S.mode === "shelve") {
        const zone = S.mode === "zone" ? S.scanZone : (S.dest && S.dest.zone);
        const shelf = S.mode === "shelve" && S.dest ? S.dest.shelf || null : null;
        if (!zone && !shelf) { ping(false); feedPush("bad", bc, "Scan a zone barcode first (ZONE-X)"); return; }
        const { data, error } = await S.sb.rpc("locate_shipments", {
          p_rows: [{ ship_num: shipNum, zone: zone || null, shelf }] });
        if (error) throw error;
        if (!data || !data.located) { ping(false); feedPush("bad", bc, "No shipment #" + shipNum + " in Shipping"); return; }
        S.ships = null;
        ping(true); feedPush("ok", bc, "Shipment #" + shipNum + " → " + (shelf || zone), true);
      } else {
        const { data, error } = await S.sb.from("shipments")
          .select("ship_num,client,boxes,zone,shelf").eq("ship_num", shipNum).maybeSingle();
        if (error) throw error;
        if (!data) { ping(false); feedPush("bad", bc, "No shipment #" + shipNum + " in Shipping"); return; }
        ping(true); feedPush("ok", bc, "Shipment #" + shipNum + " · " + (data.client || "—") +
          (data.boxes ? " · " + data.boxes + " boxes" : "") +
          " · " + (data.shelf || data.zone ? "at " + (data.shelf || data.zone) : "no place yet") +
          (S.mode === "lookup" ? "" : " (use Zone mode to file it)"));
      }
      return;
    } catch (e) {
      ping(false); feedPush("bad", bc, "Could not look up shipment — " + ((e && e.message) || "try again"));
      return;
    } finally { S.scanBusy = false; render(); focusScan(); }
  }

  S.scanBusy = true; render();
  try {
    let known;
    try { known = await findParcel(bc); }
    catch (e) { ping(false); feedPush("bad", bc, "Could not reach the database — try again"); return; }

    /* Zone mode: assign the parcel to the scanned zone. */
    if (S.mode === "zone") {
      if (!known) { ping(false); feedPush("bad", bc, "No parcel with this barcode"); return; }
      if (!S.scanZone) { ping(false); feedPush("bad", bc, "Scan a zone barcode first (ZONE-X)"); return; }
      try {
        const res = await moveParcel(known, "shelved", { zone: S.scanZone, shelf: "" });
        S.undo = { barcode: bc, name: known.name, before: res.before };
        S.stats = null; S.rows = null; S.zoneStats = null;
        ping(true); feedPush("ok", bc, (known.name || "Parcel") + " → zone " + S.scanZone, true);
      } catch (e) {
        ping(false); feedPush("bad", bc, (e && e.message) || "Could not save — try again");
      }
      return;
    }

    /* Putting away: an unknown code is a shelf label or a zone. */
    if (S.mode === "shelve" && !known) {
      const up = bc.toUpperCase();
      const zone = S.zones.find(z => z.code.toUpperCase() === up);
      if (zone) {
        S.dest = { zone: zone.code, shelf: "" };
        ping(true); feedPush("ok", bc, "Filing to zone " + zone.code);
        return;
      }
      if (!looksLikeParcelNo(up)) {
        const bad = shelfOutOfRange(up);
        if (bad) { ping(false); feedPush("bad", bc, bad); return; }
        const seen = await shelfSeen(up.replace(/\//g, "-"));
        S.dest = {
          zone: (seen && seen.zone) || zoneForShelf(up) || S.dest.zone,
          shelf: up.replace(/\//g, "-"),
        };
        ping(true);
        feedPush("ok", bc, (seen ? "Shelf " : "New shelf ") + S.dest.shelf +
          " — now scan the parcels going here");
        return;
      }
    }

    if (!known) {
      ping(false);
      feedPush("bad", bc, sees_money()
        ? "No parcel with this barcode"
        : "No parcel with this barcode — the office adds new ones");
      return;
    }

    if (S.mode === "lookup") {
      ping(true);
      feedPush("ok", bc, (known.name || "Parcel") + " · " + (STATUS[known.status] || known.status) +
        (known.shelf ? " at " + known.shelf : known.zone ? " in " + known.zone : "") +
        (known.customer ? " · for " + known.customer : ""));
      return;
    }

    const to = MODES[S.mode].to;
    if (known.status === to) {
      ping(false);
      feedPush("warn", bc, (known.name || "This parcel") + " is already " +
        (STATUS[to] || to).toLowerCase());
      return;
    }

    let loc = null;
    if (S.mode === "shelve") {
      if (!S.dest.zone && !S.dest.shelf) {
        ping(false); feedPush("bad", bc, "Scan a shelf label first, or pick a zone");
        return;
      }
      loc = { zone: S.dest.zone, shelf: S.dest.shelf };
    }
    if (S.mode === "receive") loc = { zone: S.recvZone || "", shelf: "" };
    if (S.mode === "branch") {
      const b = S.branchZone || (theBranch() && theBranch().code) || "";
      if (!b) {
        ping(false); feedPush("bad", bc, "No branch office is set up — add one in Setup");
        return;
      }
      loc = { zone: b, shelf: "" };
    }
    if (S.mode === "release" || S.mode === "deliver") loc = { shelf: "" };

    try {
      const res = await moveParcel(known, to, loc);
      S.undo = { barcode: bc, name: known.name, before: res.before };
      /* The counts and the list are now a move out of date. Rather than pay
         for a recount after every scan — the gun fires faster than that —
         they are dropped, and rebuilt when someone next looks at them. */
      S.stats = null; S.rows = null; S.zoneStats = null;
      ping(true);
      const where = S.mode === "shelve" ? " → " + (S.dest.shelf || S.dest.zone)
                  : S.mode === "receive" && S.recvZone ? " → " + S.recvZone : "";
      feedPush("ok", bc, MODES[S.mode].verb + ": " + (known.name || "parcel") + where, true);
    } catch (e) {
      ping(false);
      /* The trigger's own words are better than anything generic. */
      feedPush("bad", bc, (e && e.message) || "Could not save — try again");
    }
  } finally {
    S.scanBusy = false;
    render();
    focusScan();
  }
}

async function doUndo() {
  const u = S.undo;
  if (!u) return;
  S.undo = null;
  try {
    const { error } = await S.sb.from("parcels").update({
      status: u.before.status, zone: u.before.zone || null, shelf: u.before.shelf || null,
    }).eq("barcode", u.barcode);
    if (error) throw error;
    await S.sb.from("parcel_events").insert({
      barcode: u.barcode, at: new Date().toISOString(), actor: S.me.id,
      from_status: null, to_status: u.before.status,
      loc: u.before.shelf || u.before.zone || null, note: "undone by " + S.me.name,
    });
    ping(true);
    feedPush("ok", u.barcode, "Put back to " + (STATUS[u.before.status] || u.before.status));
  } catch (e) {
    ping(false);
    feedPush("bad", u.barcode, "Could not undo — " + ((e && e.message) || "try again"));
  }
  render(); focusScan();
}

/* The "filing to" card pulses once whenever its target changes. */
function destPulse(now) {
  const changed = (now || "") !== (S._destShown == null ? "" : S._destShown);
  S._destShown = now || "";
  return changed && now ? " pulse" : "";
}

function vScan() {
  const v = el("section");

  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Scan"));
  h.append(el("div", "sub", MODES[S.mode].label + " — " + MODES[S.mode].sub));
  head.append(h);
  const snd = el("button", "btn sm", S.beep ? "Sound on" : "Sound off");
  snd.style.marginLeft = "auto";
  snd.onclick = () => { S.beep = !S.beep; if (S.beep) ping(true); render(); focusScan(); };
  head.append(snd);
  headExport(head, () => {
    if (!S.scanFeed.length) { toast("Nothing scanned yet.", "bad"); return; }
    writeCsv("scans", [
      [r => new Date(r.t).toLocaleString("en-GB"), "Time"],
      ["bc", "Code scanned"],
      [r => r.kind === "ok" ? "OK" : r.kind === "bad" ? "Refused" : r.kind, "Result"],
      ["msg", "What happened"],
    ], S.scanFeed.slice().reverse());
  });
  v.append(head);

  /* mode */
  const modes = el("div", "modes");
  for (const k in MODES) {
    const b = el("button", "mode m-" + k + (k === S.mode ? " on" : ""));
    b.append(icon(k));
    const tx = el("div", "mode-tx");
    tx.append(el("b", null, MODES[k].label));
    tx.append(el("span", null, MODES[k].sub));
    b.append(tx);
    b.onclick = () => { S.mode = k; render(); focusScan(); };
    modes.append(b);
  }
  v.append(modes);

  /* where it is going */
  if (S.mode === "shelve") {
    const d = el("div", "card pad dest" + destPulse(S.dest.shelf || S.dest.zone));
    d.style.marginBottom = "12px";
    const r = el("div", "row");
    r.append(el("span", "li-s", "Filing to"));
    const now = S.dest.shelf || S.dest.zone;
    const tag = el("span", "mono dest-tag" + (now ? "" : " none"), now || "nowhere yet");
    r.append(tag);
    const sel = el("select", "inp sm");
    sel.style.width = "auto"; sel.style.minHeight = "34px"; sel.style.marginLeft = "auto";
    const none = el("option", null, "pick a zone…"); none.value = "";
    sel.append(none);
    for (const z of S.zones) {
      const o = el("option", null, z.label || z.code);
      o.value = z.code;
      if (z.code === S.dest.zone && !S.dest.shelf) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => { S.dest = { zone: sel.value, shelf: "" }; render(); focusScan(); };
    r.append(sel);
    if (now) {
      const clr = el("button", "btn sm", "Clear");
      clr.onclick = () => { S.dest = { zone: "", shelf: "" }; render(); focusScan(); };
      r.append(clr);
    }
    d.append(r);
    d.append(el("div", "li-s", "Scan a shelf label to change it. Every parcel scanned after " +
      "that goes to this shelf until you scan another."));
    v.append(d);
  }
  if (S.mode === "branch") {
    const bz = branchZones();
    const d = el("div", "card pad");
    d.style.marginBottom = "12px";
    if (!bz.length) {
      d.append(banner("bad", "No branch office set up yet",
        "Add a zone in Setup and set its type to “Branch office”."));
    } else {
      const r = el("div", "row");
      r.append(el("span", "li-s", "Going to"));
      const sel = el("select", "inp sm");
      sel.style.width = "auto"; sel.style.minHeight = "34px";
      for (const z of bz) {
        const o = el("option", null, z.label || z.code);
        o.value = z.code;
        if ((S.branchZone || (theBranch() && theBranch().code)) === z.code) o.selected = true;
        sel.append(o);
      }
      sel.onchange = () => { S.branchZone = sel.value; render(); focusScan(); };
      r.append(sel);
      d.append(r);
      d.append(el("div", "sub2", "These leave the warehouse but are not delivered yet — " +
        "the customer collects them there. Mark them delivered when they do. " +
        "Parcels sent via Waseet go out for cash-on-delivery."));
    }
    v.append(d);
  }
  if (S.mode === "zone") {
    const d = el("div", "card pad dest" + destPulse(S.scanZone));
    d.style.marginBottom = "12px";
    const r = el("div", "row");
    r.append(el("span", "li-s", "Assigning to zone"));
    const tag = el("span", "mono dest-tag" + (S.scanZone ? "" : " none"), S.scanZone || "none yet");
    r.append(tag);
    const sel = el("select", "inp sm");
    sel.style.width = "auto"; sel.style.minHeight = "34px"; sel.style.marginLeft = "auto";
    const none = el("option", null, "or pick…"); none.value = "";
    sel.append(none);
    for (const z of S.zones) {
      const o = el("option", null, z.label || z.code);
      o.value = z.code;
      if (z.code === S.scanZone) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => { S.scanZone = sel.value; render(); focusScan(); };
    r.append(sel);
    if (S.scanZone) {
      const clr = el("button", "btn sm", "Clear");
      clr.onclick = () => { S.scanZone = ""; render(); focusScan(); };
      r.append(clr);
    }
    d.append(r);
    d.append(el("div", "li-s", "Scan a zone barcode (ZONE-A, ZONE-B…) or pick from the list, " +
      "then scan parcels to assign them there. Shipment barcodes (SHIP-123) assign all parcels in that shipment."));
    v.append(d);
  }
  if (S.mode === "receive") {
    const d = el("div", "card pad");
    d.style.marginBottom = "12px";
    const r = el("div", "row");
    r.append(el("span", "li-s", "Landing in"));
    const sel = el("select", "inp sm");
    sel.style.width = "auto"; sel.style.minHeight = "34px";
    for (const z of S.zones.filter(z => z.kind === "staging")) {
      const o = el("option", null, z.label || z.code);
      o.value = z.code;
      if (z.code === S.recvZone) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => { S.recvZone = sel.value; render(); focusScan(); };
    r.append(sel);
    d.append(r);
    v.append(d);
  }

  /* the gun */
  /* A new result since the last draw flashes the box in its colour. */
  const latest = S.scanFeed[0];
  const isNew = !!latest && latest.t !== S._flashT;
  if (latest) S._flashT = latest.t;
  const form = el("form", "scanbox m-" + S.mode +
    (isNew ? " flash-" + (latest.kind === "ok" ? "ok" : latest.kind === "warn" ? "warn" : "bad") : ""));
  const fld = el("div", "scanfield");
  fld.append(icon("barcode", "scan-ico"));
  fld.append(el("i", "laser"));
  const inp = el("input", "inp mono");
  inp.id = "scanin";
  inp.placeholder = S.mode === "shelve" ? "Scan a shelf label, then parcels…" : "Scan a barcode…";
  inp.autocomplete = "off"; inp.autocapitalize = "off"; inp.spellcheck = false;
  inp.enterKeyHint = "go";
  fld.append(inp);
  form.append(fld);
  const go = el("button", "btn pri", S.scanBusy ? "…" : "Enter");
  go.type = "submit";
  go.disabled = !!S.scanBusy;
  form.append(go);
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const val = inp.value;
    inp.value = "";
    if (!S.scanBusy) handleScan(val);
  });
  v.append(form);

  if (S.undo) {
    const u = el("div", "row");
    u.style.margin = "10px 0";
    const b = el("button", "btn", "Undo: " + (S.undo.name || S.undo.barcode).slice(0, 40));
    b.onclick = doUndo;
    u.append(b);
    v.append(u);
  }

  /* what just happened */
  if (!S.scanFeed.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "Nothing scanned yet"));
    e.append(document.createTextNode(S.mode === "lookup"
      ? "Look up changes nothing — scan anything to see where it is."
      : "Each scan will " + MODES[S.mode].verb.toLowerCase() + " the parcel and show up here."));
    v.append(e);
  } else {
    const t = S.scanTally || { ok: 0, warn: 0, bad: 0 };
    const tally = el("div", "tally");
    const pill = (cls, n, label) => {
      const p = el("span", "tpill " + cls);
      p.append(el("b", "num", nf0.format(n)), document.createTextNode(" " + label));
      return p;
    };
    tally.append(el("span", "sect-t", "This session"),
      pill("ok", t.ok, "done"), pill("warn", t.warn, "skipped"), pill("bad", t.bad, "refused"));
    v.append(tally);
    const list = el("div", "list feed");
    for (const f of S.scanFeed) {
      const kind = f.kind === "ok" ? "delivered" : f.kind === "warn" ? "received" : "bad";
      const li = el("div", "li click rec st-" + kind + (f === latest && isNew ? " fresh" : ""));
      /* A scan line is the quickest way back to the parcel it was about. */
      li.onclick = () => openParcel(f.bc);
      const m = el("div", "li-m");
      const nm = el("div", "li-nm");
      nm.append(el("span", "mono", f.bc), copyBtn(f.bc));
      nm.append(el("span", "chip " + (f.kind === "ok" ? "s-delivered" : f.kind === "warn" ? "s-received" : "off"),
        f.kind === "ok" ? "Done" : f.kind === "warn" ? "Skipped" : "No"));
      m.append(nm);
      m.append(el("div", "li-s", f.msg));
      li.append(m);
      li.append(el("span", "li-s mono", new Date(f.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })));
      list.append(li);
    }
    v.append(list);
  }

  /* Loading the day's scan file belongs here, with the scanning — not behind
     Setup, which the people who actually walk the floor cannot open. */
  v.append(scanFileDrop());
  setTimeout(focusScan, 0);
  return v;
}

function scanFileDrop() {
  if (S.imp && S.imp.kind === "scan") return scanSection();
  const card = el("div", "card pad");
  card.style.marginTop = "18px";
  const hr = el("div", "hr-t");
  hr.append(el("span", "sect-t", "Load a scan from the PDA"));
  card.append(hr);
  card.append(el("div", "sub2", "The file the shelf scanner exports — barcode, " +
    "shelf, scanned at. Every parcel in it goes onto the shelf it was scanned on. " +
    "Pick several at once (A, B, C, D…) to load a whole sweep together."));
  const row = el("div", "row");
  row.style.marginTop = "9px";
  const pick = el("input");
  pick.type = "file";
  pick.multiple = true;
  pick.accept = ".csv,.tsv,text/csv";
  pick.className = "inp";
  pick.onchange = () => { if (pick.files && pick.files.length) readScanFiles([...pick.files]); };
  row.append(pick);
  card.append(row);
  if (S.impBusy) {
    const b = el("div", "sub2");
    b.style.marginTop = "8px";
    b.append(el("span", "spin"));
    b.append(document.createTextNode(" reading the file…"));
    card.append(b);
  }
  if (S.impError) card.append(banner("bad", "Could not read that file", S.impError));
  /* A dashboard export is office work and has its own screen. */
  if (S.imp && S.imp.kind === "export")
    card.append(banner("warn", "That looks like a dashboard export, not a floor scan",
      sees_money() ? "Bring it in from Setup instead, where the columns can be matched up."
                   : "Ask the office to bring that one in."));
  return card;
}

/* ----------------------------------------------------------------- stock --- */
/* Everything the warehouse knows about, counted and filtered by the database
   rather than pulled down and sifted here. Eight thousand parcels is more than
   a scanning gun should ever have to hold in memory, and the counts have to be
   right for the caller: a scanner's tiles simply have no money on them,
   because the figures never leave the database. */

/* ------------------------------------------------- call-centre stock --- */

async function loadCallCenterStock() {
  S.ccLoading = true; render();
  const term = S.ccQ.trim();
  let qy = S.sb.from("parcels_view")
    .select("barcode,name,client_id,customer,phone,status,zone,shelf,cost,paid,shipped_at,age_days");
  if (S.ccStatus === "in_warehouse") qy = qy.in("status", ["received", "shelved"]);
  else if (S.ccStatus) qy = qy.eq("status", S.ccStatus);
  if (term) {
    const like = "%" + term.replace(/[%,()]/g, " ") + "%";
    const parts = [
      "barcode.ilike." + like,
      "client_id.ilike." + like,
      "customer.ilike." + like,
      "phone.ilike." + like,
    ];
    qy = qy.or(parts.join(","));
  }
  const { data, error } = await qy.order("client_id").order("barcode");
  S.ccLoading = false;
  if (error) { toast(error.message, "bad"); S.ccData = []; render(); return; }

  const map = {};
  for (const r of (data || [])) {
    const cid = r.client_id || "—";
    if (!map[cid]) map[cid] = { client_id: cid, customer: r.customer || "", phone: r.phone || "", parcels: [], totalCost: 0 };
    map[cid].parcels.push(r);
    map[cid].totalCost += Number(r.cost) || 0;
    if (!map[cid].customer && r.customer) map[cid].customer = r.customer;
    if (!map[cid].phone && r.phone) map[cid].phone = r.phone;
  }

  S.ccData = Object.values(map);
  if (S.ccSort === "most") S.ccData.sort((a, b) => b.parcels.length - a.parcels.length);
  else S.ccData.sort((a, b) => a.parcels.length - b.parcels.length);
  render();
}

function vCallCenterStock() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Stock"));
  h.append(el("div", "sub", "Search clients and view their parcels."));
  head.append(h);
  v.append(head);

  /* search + sort bar */
  const bar = el("form", "row");
  bar.style.marginBottom = "14px";
  const q = el("input", "inp mono");
  q.placeholder = "Client number, name, phone or barcode…";
  q.value = S.ccQ;
  q.autocomplete = "off";
  q.style.flex = "1 1 240px";
  bar.append(q);

  const sf = el("select", "inp");
  sf.style.width = "auto";
  sf.innerHTML = '<option value="">All statuses</option>'
    + '<option value="expected">On the way</option>'
    + '<option value="in_warehouse">In warehouse</option>'
    + '<option value="at_branch">At branch</option>'
    + '<option value="released">With Waseet</option>'
    + '<option value="delivered">Delivered</option>';
  sf.value = S.ccStatus;
  sf.onchange = () => { S.ccStatus = sf.value; S.ccData = null; loadCallCenterStock(); };
  bar.append(sf);

  const ss = el("select", "inp");
  ss.style.width = "auto";
  ss.innerHTML = '<option value="most">Most parcels first</option><option value="least">Fewest parcels first</option>';
  ss.value = S.ccSort;
  ss.onchange = () => { S.ccSort = ss.value; S.ccData = null; loadCallCenterStock(); };
  bar.append(ss);

  const go = el("button", "btn pri", "Search");
  go.type = "submit";
  bar.append(go);

  if (S.ccQ || S.ccStatus) {
    const clr = el("button", "btn", "Clear");
    clr.type = "button";
    clr.onclick = () => { S.ccQ = ""; S.ccStatus = ""; S.ccData = null; loadCallCenterStock(); };
    bar.append(clr);
  }
  bar.addEventListener("submit", ev => { ev.preventDefault(); S.ccQ = q.value; S.ccData = null; loadCallCenterStock(); });
  v.append(bar);

  /* loading / empty */
  if (S.ccLoading || !S.ccData) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading…"));
    v.append(e);
    return v;
  }
  if (!S.ccData.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "No clients found"));
    e.append(document.createTextNode(S.ccQ ? " — try a different search." : "."));
    v.append(e);
    return v;
  }

  /* client list */
  const list = el("div", "list");
  for (const g of S.ccData) {
    const open = S.ccOpen.has(g.client_id);
    const row = el("div", "li click" + (open ? " open" : ""));
    row.onclick = () => {
      if (S.ccOpen.has(g.client_id)) S.ccOpen.delete(g.client_id);
      else S.ccOpen.add(g.client_id);
      render();
    };

    const m = el("div", "li-m");
    const nm = el("div", "li-nm");
    nm.append(el("span", "mono", open ? "▼" : "▶"));
    nm.append(el("span", "mono", " " + g.client_id));
    if (g.customer) nm.append(el("span", null, " — " + g.customer));
    m.append(nm);
    const info = g.parcels.length + " parcel" + (g.parcels.length === 1 ? "" : "s");
    m.append(el("div", "li-s", info + (g.phone ? "  ·  " + g.phone : "")));
    row.append(m);

    const a = el("div", "li-a");
    const c = el("span", "mono num", money(g.totalCost));
    c.style.fontWeight = "600";
    a.append(c);
    row.append(a);

    list.append(row);

    if (open) {
      const sub = el("div", "cc-sub");
      for (const r of g.parcels) {
        const pr = el("div", "li click");
        pr.style.paddingLeft = "32px";
        pr.onclick = ev => { ev.stopPropagation(); openParcel(r.barcode); };
        const pm = el("div", "li-m");
        const pnm = el("div", "li-nm");
        pnm.append(el("span", "mono", r.barcode), copyBtn(r.barcode));
        pnm.append(el("span", "chip s-" + r.status, STATUS[r.status] || r.status));
        pm.append(pnm);
        const bits = [];
        if (r.name) bits.push(r.name.length > 48 ? r.name.slice(0, 48) + "…" : r.name);
        bits.push("at " + (r.shelf || r.zone || "—"));
        pm.append(el("div", "li-s", bits.join("  ·  ")));
        pr.append(pm);
        const pa = el("div", "li-a");
        if (r.cost != null) {
          pa.append(el("span", "mono num", money(r.cost)));
          pa.append(el("span", "chip " + (r.paid ? "s-delivered" : "off"), r.paid ? "Paid" : "Unpaid"));
        }
        pr.append(pa);
        sub.append(pr);
      }
      list.append(sub);
    }
  }
  v.append(list);

  /* total count */
  const total = S.ccData.reduce((s, g) => s + g.parcels.length, 0);
  const foot = el("div", "li-s");
  foot.style.marginTop = "8px";
  foot.textContent = S.ccData.length + " client" + (S.ccData.length === 1 ? "" : "s") + ", " + nf0.format(total) + " parcels";
  v.append(foot);

  return v;
}

function vStock() {
  if (isCallCenter()) return vCallCenterStock();

  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Stock"));
  h.append(el("div", "sub", sees_money()
    ? "Every parcel the warehouse knows about."
    : "Every parcel the warehouse knows about. Charges are not shown to a scanner."));
  head.append(h);
  headExport(head, exportStockList, "Export list");
  v.append(head);

  v.append(S.bulk ? bulkSummary() : stockTiles());
  v.append(stockFilters());

  if (S.searching) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Looking…"));
    v.append(e);
    return v;
  }
  if (!S.rows) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading stock…"));
    v.append(e);
    return v;
  }
  if (!S.rows.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "Nothing matches"));
    e.append(document.createTextNode(anyFilter()
      ? "Clear a filter, or search for something else."
      : "No parcels yet."));
    v.append(e);
    return v;
  }

  v.append(selectionHead());
  const list = el("div", "list");
  for (const r of S.rows) list.append(recordRow(r));
  v.append(list);
  v.append(pager());
  if (selCount()) v.append(bulkBar());
  return v;
}

/* ---------------------------------------------------------- bulk search --- */
/* Admin only: paste a column of parcel numbers and see them all at once. The
   list below becomes exactly those parcels, so ticking, moving, paying and
   exporting all work on them as usual. */
const BULK_MAX = 5000;

function parseBulk(text) {
  const seen = new Set(), out = [];
  for (const raw of String(text || "").split(/[\s,;|]+/)) {
    const c = raw.replace(/^['"=]+|['"]+$/g, "").trim();
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

function askBulkSearch() {
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, "Bulk search"));
  const sub = el("p", "sub", "Paste parcel numbers — one per line, or separated by spaces or commas. " +
    "Up to " + BULK_MAX + " at once. Straight from Excel works.");
  sub.style.margin = "4px 0 12px";
  m.append(sub);
  const err = el("div");
  m.append(err);
  const ta = el("textarea", "inp mono");
  ta.rows = 10;
  ta.style.cssText = "width:100%;resize:vertical;min-height:180px";
  ta.placeholder = "435395393498783\n434785541232573\n…";
  ta.spellcheck = false;
  ta.value = S.bulk ? S.bulk.codes.join("\n") : "";
  m.append(ta);
  const count = el("div", "li-s");
  count.style.margin = "6px 0 12px";
  const recount = () => {
    const n = parseBulk(ta.value).length;
    count.textContent = nf0.format(n) + " parcel number" + (n === 1 ? "" : "s") + (n > BULK_MAX ? " — too many, keep it to " + BULK_MAX : "");
  };
  ta.addEventListener("input", recount);
  recount();
  m.append(count);
  const acts = el("div", "row");
  const go = el("button", "btn pri", "Search them");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button"; no.onclick = () => scrim.remove();
  acts.append(go, no);
  m.append(acts);
  m.addEventListener("submit", ev => {
    ev.preventDefault();
    const codes = parseBulk(ta.value);
    if (!codes.length) { err.replaceChildren(banner("bad", "Nothing to search", "Paste at least one parcel number.")); return; }
    if (codes.length > BULK_MAX) { err.replaceChildren(banner("bad", "Too many at once", "Keep it to " + BULK_MAX + " and search the rest after.")); return; }
    scrim.remove();
    if (S.tab === "stock") S.q = "";
    setBulk(codes);
  });
  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
  ta.focus();
}

/* One list of barcodes, shared by every section that lists parcels or
   shipments, until it is cleared. Each section's data is dropped so it is
   asked for again with the list applied. */
function setBulk(codes) {
  S.bulk = codes && codes.length ? { codes, found: null } : null;
  S.sel = new Set(); S.page = 0;
  S.rows = null; S.waseetData = null; S.waseetShips = null; S.ships = null;
  if (S.tab === "stock") { loadStock(); if (S.bulk) loadBulkSummary(); else loadStats(); }
  else if (S.tab === "waseet") loadWaseet();
  else if (S.tab === "shipping") loadShipments();
  render();
}

/* The admin's bulk-search strip for sections without the Stock filter bar. */
function bulkStrip() {
  if (!isAdmin()) return document.createDocumentFragment();
  const r = el("div", "row bulkstrip");
  const b = el("button", "btn sm", S.bulk ? "Edit bulk search" : "Bulk search");
  b.type = "button";
  b.onclick = askBulkSearch;
  r.append(b);
  if (S.bulk) {
    r.append(el("span", "chip admin", "showing only " + nf0.format(S.bulk.codes.length) + " searched barcodes"));
    const c = el("button", "btn sm", "Clear bulk search");
    c.type = "button";
    c.onclick = () => setBulk(null);
    r.append(c);
  }
  return r;
}

/* Shipments answer to their code or their number (SHIP-12, 12). */
function bulkShipFilter(q) {
  if (!S.bulk) return q;
  /* Long all-digit numbers are parcels, not shipments; leaving them out keeps
     the request short however many parcels were pasted. */
  const safe = S.bulk.codes.filter(c => /^[A-Za-z0-9._-]+$/.test(c) && !/^d{10,}$/.test(c)).slice(0, 300);
  const nums = safe.map(c => (/^(?:SHIP-?)?(\d{1,9})$/i.exec(c) || [])[1]).filter(Boolean);
  const parts = [];
  if (safe.length) parts.push("code.in.(" + safe.join(",") + ")");
  if (nums.length) parts.push("ship_num.in.(" + nums.join(",") + ")");
  return parts.length ? q.or(parts.join(",")) : q.eq("ship_num", -1);
}

/* What came back, and — just as important — what did not. */
async function loadBulkSummary() {
  const b = S.bulk;
  if (!b) return;
  const found = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await S.sb.rpc("parcels_by_barcodes", { p_codes: b.codes })
      .select("barcode,status,cost,paid").range(from, from + 999);
    if (error) { b.loading = false; toast("Could not check the list — " + error.message, "bad"); return; }
    found.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  if (S.bulk !== b) return;
  b.found = found;
  render();
}

function bulkSummary() {
  const b = S.bulk;
  const card = el("div", "card pad bulksum");
  card.style.marginBottom = "14px";
  if (!b.found) {
    if (!b.loading) { b.loading = true; setTimeout(loadBulkSummary, 0); }
    card.append(el("span", "spin"), document.createTextNode(" Checking " + nf0.format(b.codes.length) + " parcel numbers…"));
    return card;
  }
  const have = new Set(b.found.map(r => r.barcode));
  const missing = b.codes.filter(c => !have.has(c));
  const tiles = el("div", "tiles");
  tiles.style.marginBottom = "0";
  const t = (k, v, n, colour) => {
    const d = el("div", "tile");
    d.append(el("div", "k", k));
    const val = el("div", "v", v);
    if (colour) val.style.color = colour;
    d.append(val);
    if (n) d.append(el("div", "n", n));
    return d;
  };
  tiles.append(t("Found", nf0.format(b.found.length), "of " + nf0.format(b.codes.length) + " searched", "var(--ok)"));
  tiles.append(t("Not found", nf0.format(missing.length), missing.length ? "listed below" : "every one is here",
    missing.length ? "var(--danger)" : null));
  const by = {};
  for (const r of b.found) by[r.status] = (by[r.status] || 0) + 1;
  for (const st of ORDER) if (by[st]) tiles.append(t(STATUS[st] || st, nf0.format(by[st])));
  if (sees_money()) {
    const unpaid = b.found.filter(r => !r.paid && r.status !== "expected");
    tiles.append(t("Unpaid", money(unpaid.reduce((a, r) => a + (Number(r.cost) || 0), 0)),
      nf0.format(unpaid.length) + " parcel" + (unpaid.length === 1 ? "" : "s"), "var(--danger)"));
  }
  card.append(tiles);
  if (missing.length) {
    const box = el("div", "bulkmiss");
    const hd = el("div", "row");
    hd.append(el("span", "sect-t", "Not in the app"));
    const cp = el("button", "btn sm", "Copy all " + nf0.format(missing.length));
    cp.type = "button";
    cp.onclick = async () => {
      try { await navigator.clipboard.writeText(missing.join("\n")); toast("Copied " + missing.length + " parcel numbers", "ok"); }
      catch (_) { toast("Could not copy", "bad"); }
    };
    hd.append(cp);
    box.append(hd);
    const wrap = el("div", "bulkcodes");
    for (const c of missing) {
      const it = el("span", "bulkcode");
      it.append(el("span", "mono", c), copyBtn(c));
      wrap.append(it);
    }
    box.append(wrap);
    card.append(box);
  }
  return card;
}

const anyFilter = () =>
  !!(S.q.trim() || S.filters.status || S.filters.zone || S.filters.paid ||
     S.filters.here || S.filters.client || S.bulk);

function stockTiles() {
  const wrap = el("div", "tiles");
  const s = S.stats;
  const tile = (k, label, val, note, on) => {
    const b = el("button", "tile" + (on ? " on" : ""));
    b.append(el("div", "k", label), el("div", "v", val));
    if (note) b.append(el("div", "n", note));
    b.onclick = () => {
      const f = S.filters;
      if (!k) S.filters = { status: "", zone: f.zone, paid: "", here: f.here, client: f.client };
      else if (k === "unpaid" || k === "late" || k === "long")
        S.filters = { ...f, paid: f.paid === k ? "" : k };
      else S.filters = { ...f, status: f.status === k ? "" : k };
      applyFilters();
    };
    return b;
  };
  if (!s) {
    const b = el("div", "tile");
    b.append(el("div", "k", "Counting"), el("div", "v", "…"));
    wrap.append(b);
    return wrap;
  }
  const f = S.filters;
  const n = x => nf0.format(Number(x) || 0);
  /* When the view is narrowed, the big number is the narrowed one and the
     line under it says what it came out of — otherwise 1,605 of 8,232 reads
     like the warehouse lost seven thousand parcels. */
  const narrowed = Number(s.total) !== Number(s.total_all);
  wrap.append(
    tile("", "All parcels", n(s.total),
      narrowed ? "of " + n(s.total_all) + " in the warehouse" : null,
      !f.status && !f.paid),
    tile("expected", "On the way", n(s.expected), "still in transit", f.status === "expected"),
    tile("received", "In the warehouse", n(s.received), "not on a shelf", f.status === "received"),
    tile("shelved", "On shelves", n(s.shelved), "located", f.status === "shelved"),
    tile("at_branch", "At " + branchLabel(), n(s.at_branch), "waiting to be collected",
      f.status === "at_branch"),
    tile("released", "Waseet", n(s.released), "cash on delivery", f.status === "released"),
    tile("delivered", "Delivered", n(s.delivered), "handed over", f.status === "delivered"),
    tile("late", "Over free days", n(s.late_count), "past " + s.free_days + " days", f.paid === "late"),
    tile("long", "Here too long", n(s.long_count),
      s.long_stay_days + "+ days" + (s.long_owed != null ? " · " + money(s.long_owed) + " owed" : ""),
      f.paid === "long"),
  );
  /* No money tile for a scanner: the figures are not theirs and the database
     would hand back nulls anyway. */
  if (sees_money() && !isCallCenter())
    wrap.append(tile("unpaid", "Unpaid", money(s.unpaid_amount),
      n(s.unpaid_count) + " parcel" + (Number(s.unpaid_count) === 1 ? "" : "s"), f.paid === "unpaid"));
  return wrap;
}

function stockFilters() {
  const bar = el("form", "row");
  bar.style.marginBottom = "14px";

  const q = el("input", "inp mono");
  q.placeholder = "Barcode, client number, customer, phone, shelf or shipment…";
  q.value = S.q;
  q.autocomplete = "off";
  q.style.flex = "1 1 240px";
  bar.append(q);

  const zs = el("select", "inp");
  zs.style.width = "auto";
  const any = el("option", null, "Anywhere");
  any.value = "";
  zs.append(any);
  for (const z of S.zones) {
    const o = el("option", null, z.label || z.code);
    o.value = z.code;
    if (z.code === S.filters.zone) o.selected = true;
    zs.append(o);
  }
  /* Choosing a zone here is a plain zone filter. Only a zone card asks for
     "what is in it now", so picking from this list drops that. */
  zs.onchange = () => {
    S.filters = { ...S.filters, zone: zs.value, here: false };
    applyFilters();
  };
  bar.append(zs);

  if (sees_money()) {
    const ss = el("select", "inp");
    ss.style.width = "auto";
    ss.innerHTML = '<option value="">Sort: recent</option><option value="cost_desc">Cost: high→low</option><option value="cost_asc">Cost: low→high</option>';
    ss.value = S.stockSort;
    ss.onchange = () => { S.stockSort = ss.value; S.page = 0; loadStock(); };
    bar.append(ss);
  }

  if (S.filters.here) {
    const chip = el("span", "chip admin", "in the building");
    bar.append(chip);
  }
  if (S.filters.client) {
    const chip = el("span", "chip admin", "client " + S.filters.client);
    bar.append(chip);
  }

  if (S.bulk) {
    const chip = el("span", "chip admin", nf0.format(S.bulk.codes.length) + " barcodes");
    bar.append(chip);
  }

  const go = el("button", "btn pri", "Search");
  go.type = "submit";
  bar.append(go);

  if (isAdmin()) {
    const bulk = el("button", "btn", S.bulk ? "Edit bulk search" : "Bulk search");
    bulk.type = "button";
    bulk.onclick = askBulkSearch;
    bar.append(bulk);
  }

  if (anyFilter()) {
    const clr = el("button", "btn", "Clear");
    clr.type = "button";
    clr.onclick = () => {
      S.q = ""; S.filters = { status: "", zone: "", paid: "" }; S.stockSort = ""; S.bulk = null; S.sel = new Set(); applyFilters();
    };
    bar.append(clr);
  }
  bar.addEventListener("submit", ev => {
    ev.preventDefault();
    S.q = q.value; applyFilters();
  });
  return bar;
}

function pager() {
  const from = S.page * S.pageSize;
  const to = Math.min(from + S.rows.length, S.total);
  const w = el("div", "row");
  w.style.marginTop = "12px";
  w.append(el("span", "li-s", nf0.format(from + 1) + "–" + nf0.format(to) +
    " of " + nf0.format(S.total)));
  const prev = el("button", "btn sm", "Back");
  prev.disabled = S.page === 0;
  prev.onclick = () => { S.page--; loadStock(); };
  const next = el("button", "btn sm", "Next");
  next.disabled = to >= S.total;
  next.onclick = () => { S.page++; loadStock(); };
  const sp = el("span");
  sp.style.marginLeft = "auto";
  w.append(sp, prev, next);
  return w;
}

function recordRow(r) {
  const li = el("div", "li click rec st-" + r.status + (S.sel.has(r.barcode) ? " sel" : ""));
  li.onclick = () => openParcel(r.barcode);

  /* The tick is its own target: tapping the row opens the parcel, tapping the
     box only selects it. Shift-clicking takes everything between this row and
     the last one ticked, which is what makes a shelf's worth bearable. */
  const box = el("input", "tick");
  box.type = "checkbox";
  box.checked = S.sel.has(r.barcode);
  box.onclick = ev => {
    ev.stopPropagation();
    const codes = (S.rows || []).map(x => x.barcode);
    const here = codes.indexOf(r.barcode);
    if (ev.shiftKey && S.lastTick != null) {
      const from = Math.min(S.lastTick, here), to = Math.max(S.lastTick, here);
      for (let i = from; i <= to; i++) box.checked ? S.sel.add(codes[i]) : S.sel.delete(codes[i]);
    } else {
      box.checked ? S.sel.add(r.barcode) : S.sel.delete(r.barcode);
    }
    S.lastTick = here;
    render();
  };
  li.append(box);
  const m = el("div", "li-m");
  const nm = el("div", "li-nm");
  nm.append(el("span", "mono", r.barcode), copyBtn(r.barcode));
  nm.append(el("span", "chip s-" + r.status, STATUS[r.status] || r.status));
  m.append(nm);
  const bits = [];
  if (r.name) bits.push(r.name.length > 48 ? r.name.slice(0, 48) + "…" : r.name);
  /* The client number earns its place: it is what the money screen hands over
     when you ask for a customer's parcels, so a search by it should visibly
     match rather than leave you guessing which row it hit. */
  if (r.customer) bits.push("for " + r.customer + (r.client_id ? " (" + r.client_id + ")" : ""));
  else if (r.client_id) bits.push("client " + r.client_id);
  if (r.shipment) bits.push(r.shipment);
  const sub = el("div", "li-s");
  /* Where it is, as a little location tag — the first thing anyone looks for. */
  sub.append(el("span", "loc mono", "at " + (r.shelf || r.zone || "—")));
  if (bits.length) sub.append(document.createTextNode("  " + bits.join("  ·  ")));
  m.append(sub);
  li.append(m);

  const a = el("div", "li-a");
  /* r.cost is null for a scanner — the database masked it, not the screen. */
  if (r.cost != null) {
    const c = el("span", "mono num amt", money(r.cost));
    a.append(c);
    a.append(el("span", "chip " + (r.paid ? "s-delivered" : "off"), r.paid ? "Paid" : "Unpaid"));
  }
  if (r.age_days != null && (r.status === "shelved" || r.status === "received"))
    a.append(el("span", "li-s", "held " + nf0.format(r.age_days) + " days"));
  else if (r.shipped_at)
    a.append(el("span", "li-s", "shipped " + fmtDate(r.shipped_at)));
  li.append(a);
  return li;
}

/* The filters, in one place. The list asks for the columns it shows and an
   exact count; selecting everything that matches asks the very same question
   for barcodes alone, so the two can never drift apart. */
function stockQuery(cols, withCount) {
  const f = S.filters;
  /* A bulk search sends its barcodes in the request body, so thousands fit. */
  let qy = S.bulk
    ? S.sb.rpc("parcels_by_barcodes", { p_codes: S.bulk.codes }, withCount ? { count: "exact" } : undefined)
        /* Through a function the list can only sort on columns it fetches. */
        .select(/(^|,)updated_at(,|$)/.test(cols) ? cols : cols + ",updated_at")
    : S.sb.from("parcels_view").select(cols, withCount ? { count: "exact" } : undefined);

  if (f.status) qy = qy.eq("status", f.status);
  if (f.zone) qy = qy.eq("zone", f.zone);
  if (f.here) qy = qy.not("status", "in", "(released,delivered)");
  /* "This client's parcels" is an exact question and deserves an exact answer:
     a short client number like 65 is also a substring of hundreds of barcodes,
     so asking it as free text buries the answer. */
  if (f.client) qy = qy.eq("client_id", f.client);

  /* "Still here" is what the late and long-stay counts mean, so the list has
     to agree with the tile it came from. */
  const free = (S.stats && S.stats.free_days) || 14;
  const long = (S.stats && S.stats.long_stay_days) || 90;
  if (f.paid === "late") qy = qy.in("status", ["shelved", "received"]).gt("age_days", free);
  if (f.paid === "long") qy = qy.in("status", ["shelved", "received"]).gte("age_days", long);
  if (f.paid === "unpaid") {
    qy = qy.eq("paid", false).neq("status", "expected");
    /* Hamra and Waseet parcels are not counted as owed to the warehouse —
       unless that is the status being looked at. */
    if (f.status !== "at_branch" && f.status !== "released")
      qy = qy.not("status", "in", "(at_branch,released)");
  }

  const term = S.q.trim();
  if (term) {
    const like = "%" + term.replace(/[%,()]/g, " ") + "%";
    qy = qy.or([
      "barcode.ilike." + like,
      "client_id.ilike." + like,
      "customer.ilike." + like,
      "phone.ilike." + like,
      "shelf.ilike." + like,
      "shipment.ilike." + like,
    ].join(","));
  }

  if (S.stockSort === "cost_desc") qy = qy.order("cost", { ascending: false, nullsFirst: false });
  else if (S.stockSort === "cost_asc") qy = qy.order("cost", { ascending: true, nullsFirst: false });
  else qy = qy.order("updated_at", { ascending: false });
  return qy.order("barcode");
}

const STOCK_COLS =
  "barcode,name,client_id,customer,phone,shipment,status,zone,shelf,cost,paid,shipped_at,age_days";

async function loadStock() {
  S.searching = true; render();
  const from = S.page * S.pageSize;
  const { data, error, count } = await stockQuery(STOCK_COLS, true)
    .range(from, from + S.pageSize - 1);

  S.searching = false;
  if (error) {
    toast(error.message, "bad");
    S.rows = [];
    render();
    return;
  }
  S.rows = data || [];
  S.total = count || 0;
  /* A filter change can leave the page past the end — step back rather than
     show an empty list that looks like "nothing matches". */
  if (!S.rows.length && S.total > 0 && S.page > 0) {
    S.page = Math.max(0, Math.ceil(S.total / S.pageSize) - 1);
    return loadStock();
  }
  render();
}

async function loadStats() {
  const f = S.filters;
  const { data, error } = await S.sb.rpc("stock_summary", {
    p_search: S.q.trim() || null,
    p_zone: f.zone || null,
    p_client: f.client || null,
    p_status: f.status || null,
    p_paid: f.paid || null,
    p_here: !!f.here,
  });
  if (error) { toast("Could not count the stock — " + error.message, "bad"); return; }
  S.stats = (data && data[0]) || null;
  render();
}

/* A filter or a search changes both the list and every tile above it, so they
   are asked for together. Turning a page changes neither, and asks for the
   list alone. */
function applyFilters() {
  S.page = 0;
  loadStats();
  loadStock();
}

/* ------------------------------------------------------------ selecting --- */
/* Ticking parcels and doing one thing to all of them. The work happens in the
   database in a single call, so a hundred and fifty parcels either all move or
   none do, and each one gets its own line in its own history.

   Selecting is by barcode rather than by row, so a selection survives paging
   and the list reloading under it. */

const selCount = () => S.sel.size;

function selectionHead() {
  const w = el("div", "selhead");
  const all = el("input");
  all.type = "checkbox";
  const pageCodes = (S.rows || []).map(r => r.barcode);
  const onPage = pageCodes.filter(b => S.sel.has(b)).length;
  all.checked = pageCodes.length > 0 && onPage === pageCodes.length;
  all.indeterminate = onPage > 0 && onPage < pageCodes.length;
  all.onchange = () => {
    if (all.checked) pageCodes.forEach(b => S.sel.add(b));
    else pageCodes.forEach(b => S.sel.delete(b));
    render();
  };
  w.append(all);
  w.append(el("span", "li-s", selCount()
    ? nf0.format(selCount()) + " selected"
    : "Tick parcels to work on several at once"));

  /* Everything that matches, not just this page — but it has to be asked for,
     and it says how many, because the difference between fifty and eight
     thousand matters a great deal to what happens next. */
  if (S.total > (S.rows || []).length) {
    const more = el("button", "btn sm", S.selAllBusy
      ? "Collecting…" : "Select all " + nf0.format(S.total) + " matching");
    more.type = "button";
    more.disabled = !!S.selAllBusy;
    more.onclick = selectAllMatching;
    more.style.marginLeft = "auto";
    w.append(more);
  }
  return w;
}

/* The same query the list uses, asking only for barcodes, a page at a time. */
async function selectAllMatching() {
  S.selAllBusy = true; render();
  const size = 1000;
  try {
    for (let from = 0; from < S.total; from += size) {
      const { data, error } = await stockQuery("barcode", false).range(from, from + size - 1);
      if (error) throw error;
      for (const r of (data || [])) S.sel.add(r.barcode);
      if (!data || !data.length) break;
    }
    toast(nf0.format(S.sel.size) + " selected", "ok");
  } catch (e) {
    toast("Could not select them all — " + ((e && e.message) || "try again"), "bad");
  }
  S.selAllBusy = false;
  render();
}

function bulkBar() {
  const bar = el("div", "bulkbar");
  bar.append(el("b", null, nf0.format(selCount()) + " selected"));

  const act = (label, fn, cls) => {
    const b = el("button", "btn sm" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.disabled = !!S.bulkBusy;
    b.onclick = fn;
    bar.append(b);
  };

  if (sees_money()) {
    act("Mark paid", () => askBulkPaid(true));
    act("Mark unpaid", () => askBulkPaid(false));
  }
  act("→ In the warehouse", () => askBulkMove("received"));
  act("→ On a shelf", () => askBulkMove("shelved"));
  act("→ " + branchLabel(), () => askBulkMove("at_branch"));
  act("→ Waseet", () => askBulkMove("released"));
  act("→ Delivered", () => askBulkMove("delivered"));
  if (canExport()) act("Export", exportSelection);
  act("Clear", () => { S.sel.clear(); render(); });
  if (S.bulkBusy) bar.append(el("span", "spin"));
  return bar;
}

/* Anything that changes a lot of records at once says exactly what it is about
   to do and waits to be told to. Putting away also needs somewhere to put. */
function askBulkMove(to) {
  const n = selCount();
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, "Move " + nf0.format(n) + " parcel" + (n === 1 ? "" : "s")));
  const sub = el("p", "sub", "to " + (STATUS[to] || to).toLowerCase() +
    ". Each one gets a line in its history with your name.");
  sub.style.margin = "4px 0 14px";
  m.append(sub);
  const err = el("div");
  m.append(err);

  let zoneSel = null, shelfInp = null;
  if (to === "at_branch") {
    const bz = branchZones();
    if (!bz.length) {
      m.append(banner("bad", "No branch office set up yet",
        "Add a zone in Setup and set its type to “Branch office”."));
    } else {
      const w = el("label", "field");
      w.append(el("span", null, "Which branch"));
      zoneSel = el("select", "inp");
      for (const z of bz) {
        const o = el("option", null, z.label || z.code);
        o.value = z.code;
        zoneSel.append(o);
      }
      w.append(zoneSel);
      w.append(el("div", "sub2", "They leave the warehouse but are not delivered — " +
        "mark them delivered when the customer collects."));
      m.append(w);
    }
  }
  if (to === "shelved") {
    const zw = el("label", "field");
    zw.append(el("span", null, "Zone"));
    zoneSel = el("select", "inp");
    const none = el("option", null, "— leave as it is —");
    none.value = "";
    zoneSel.append(none);
    for (const z of S.zones) {
      const o = el("option", null, z.label || z.code);
      o.value = z.code;
      zoneSel.append(o);
    }
    zw.append(zoneSel);
    m.append(zw);

    const sw = el("label", "field");
    sw.append(el("span", null, "Shelf"));
    shelfInp = el("input", "inp mono");
    shelfInp.placeholder = "C21-01-02";
    sw.append(shelfInp);
    sw.append(el("div", "sub2", "Leave blank to shelve them without a location. " +
      "Putting parcels away one at a time on the Scan screen is better — there " +
      "a shelf label sets this for you."));
    m.append(sw);
  }
  if (to === "at_branch" || to === "released" || to === "delivered")
    m.append(banner(null, "This clears their shelf",
      "A parcel out with a driver is not on a shelf any more."));
  if (n > 200)
    m.append(banner("warn", "That is a lot of parcels",
      "Check the filter above the list is what you meant before going ahead."));

  const acts = el("div", "row");
  const go = el("button", "btn pri", "Move them");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button";
  no.onclick = () => scrim.remove();
  acts.append(go, no);
  m.append(acts);

  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (to === "at_branch" && !zoneSel) {
      err.replaceChildren(banner("bad", "Nowhere to send them",
        "Set up a branch office in Setup first."));
      return;
    }
    const shelf = shelfInp ? shelfInp.value.trim().toUpperCase() : "";
    if (shelf) {
      const bad = shelfOutOfRange(shelf);
      if (bad) { err.replaceChildren(banner("bad", "That shelf does not exist", bad)); return; }
    }
    go.disabled = true; no.disabled = true;
    scrim.remove();
    await runBulk(() => S.sb.rpc("bulk_move", {
      p_barcodes: [...S.sel], p_to: to,
      p_zone: zoneSel ? (zoneSel.value || (shelf ? zoneForShelf(shelf) : "")) || null : null,
      p_shelf: shelf || null,
    }), d => nf0.format(d.moved) + " moved" +
         (d.skipped ? ", " + nf0.format(d.skipped) + " already there" : ""));
  });

  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

function askBulkPaid(paid) {
  const n = selCount();
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, (paid ? "Mark " : "Un-mark ") + nf0.format(n) +
    " parcel" + (n === 1 ? "" : "s") + (paid ? " paid" : "")));
  const err = el("div");
  m.append(err);

  let sel = null;
  if (paid) {
    const f = el("label", "field");
    f.append(el("span", null, "How did they pay?"));
    sel = el("select", "inp");
    for (const o of PAY_METHODS) {
      const x = el("option", null, o);
      x.value = o;
      sel.append(x);
    }
    f.append(sel);
    m.append(f);
  } else {
    m.append(banner("warn", "This undoes a payment",
      "Their charges go back to outstanding. Each one is recorded with your name."));
  }

  const acts = el("div", "row");
  const go = el("button", "btn pri", paid ? "Mark paid" : "Mark unpaid");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button";
  no.onclick = () => scrim.remove();
  acts.append(go, no);
  m.append(acts);

  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    scrim.remove();
    await runBulk(() => S.sb.rpc("bulk_set_paid", {
      p_barcodes: [...S.sel], p_paid: paid,
      p_method: sel ? sel.value : "CASH",
    }), d => nf0.format(d.changed) + (paid ? " marked paid · " + money(d.amount)
                                           : " marked unpaid"));
  });

  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

async function runBulk(call, describe) {
  S.bulkBusy = true; render();
  const { data, error } = await call();
  S.bulkBusy = false;
  if (error) {
    toast(error.message, "bad");
    render();
    return;
  }
  const d = (data && data[0]) || {};
  toast(describe(d), "ok");
  S.sel.clear();
  /* Everything downstream of this is now a step behind. */
  S.stats = null; S.money = null; S.customers = null; S.zoneStats = null;
  loadStats();
  if (S.tab === "sales") loadSales(); else loadStock();
}

/* ------------------------------------------------------------- download --- */
function offerFile(name, text, type) {
  try {
    const blob = new Blob(["﻿" + text], { type: (type || "text/csv") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (_) { return false; }
}

const csvCell = v => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/* Exporting is for the office and the admin only — not scanners, not the call
   centre — so it has its own test rather than sees_money(). */
const canExport = () => !!S.me && (S.me.role === "office" || S.me.role === "admin");

/* cols: [[key or (row) => value, header], …] */
function writeCsv(base, cols, rows) {
  const csv = [cols.map(c => csvCell(c[1])).join(",")]
    .concat(rows.map(r => cols.map(c => csvCell(typeof c[0] === "function" ? c[0](r) : r[c[0]])).join(",")))
    .join("\n");
  const name = base + "-" + new Date().toISOString().slice(0, 10) + ".csv";
  if (offerFile(name, csv)) toast(nf0.format(rows.length) + " row" + (rows.length === 1 ? "" : "s") + " exported", "ok");
  else toast("The browser would not save the file.", "bad");
}

/* An Export button at the right of a section's header, or nothing for anyone else. */
function headExport(head, fn, label) {
  if (!canExport()) return;
  const b = el("button", "btn sm", label || "Export");
  b.type = "button";
  b.title = "Download what this section shows as a spreadsheet (CSV)";
  if (![...head.children].some(c => c.style && c.style.marginLeft === "auto")) b.style.marginLeft = "auto";
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); }
    catch (e) { toast("Could not export — " + ((e && e.message) || "try again"), "bad"); }
    finally { b.disabled = false; }
  };
  head.append(b);
}

const PARCEL_COLS = ["barcode", "name", "client_id", "customer", "phone", "shipment",
                     "status", "zone", "shelf", "qty", "weight_kg", "cbm", "dims",
                     "origin", "route", "age_days", "cost", "paid", "pay_method", "cny", "declared"];
const PARCEL_HEAD = { barcode: "Parcel no.", name: "Item", client_id: "Client no.",
  customer: "Client", phone: "Phone", shipment: "Shipment", status: "Status",
  zone: "Zone", shelf: "Shelf", qty: "Qty", weight_kg: "Weight (kg)",
  cbm: "Volume (CBM)", dims: "Box size", origin: "From", route: "Route",
  age_days: "Days held", cost: "Charge (USD)", paid: "Paid",
  pay_method: "Payment method", cny: "Amount (CNY)", declared: "Declared" };

/* Every parcel the current search, filters and sort match — not just this page. */
async function exportStockList() {
  const rows = [], PAGE = 1000, MAX = 50000;
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await stockQuery(PARCEL_COLS.join(",")).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  writeCsv("stock", PARCEL_COLS.map(c => [c === "status" ? r => STATUS[r.status] || r.status : c, PARCEL_HEAD[c]]), rows);
}

/* The selection may be larger than what is on screen, so the rows are fetched
   back before they can be written out. */
async function exportSelection() {
  const codes = [...S.sel];
  if (!codes.length) { toast("Nothing selected.", "bad"); return; }
  S.bulkBusy = true; render();
  const cols = PARCEL_COLS;
  const rows = [];
  try {
    for (let i = 0; i < codes.length; i += 300) {
      const { data, error } = await S.sb.from("parcels_view")
        .select(cols.join(",")).in("barcode", codes.slice(i, i + 300));
      if (error) throw error;
      rows.push(...(data || []));
    }
  } catch (e) {
    S.bulkBusy = false;
    toast("Could not read them back — " + ((e && e.message) || "try again"), "bad");
    render();
    return;
  }
  rows.sort((a, b) => String(a.barcode).localeCompare(String(b.barcode)));
  const HEAD = PARCEL_HEAD;
  const csv = [cols.map(c => csvCell(HEAD[c] || c)).join(",")]
    .concat(rows.map(r => cols.map(c => csvCell(r[c])).join(",")))
    .join("\n");
  S.bulkBusy = false;
  const name = "parcels-" + new Date().toISOString().slice(0, 10) + ".csv";
  if (offerFile(name, csv)) toast(nf0.format(rows.length) + " rows exported", "ok");
  else toast("The browser would not save the file.", "bad");
  render();
}

/* ----------------------------------------------------------------- zones --- */
function vZones() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Zones"));
  h.append(el("div", "sub", "How the floor is divided. Shelf zones hold located stock; " +
    "staging areas are inside the warehouse but not on shelves."));
  head.append(h);
  headExport(head, () => {
    if (!S.zoneStats) { toast("Still counting the zones.", "bad"); return; }
    writeCsv("zones", [
      ["code", "Zone"], ["label", "Name"], ["kind", "Kind"], ["parcels", "Parcels"],
      ["racks", "Racks"], ["levels", "Levels"], ["locations_used", "Locations in use"],
      ["capacity", "Capacity"], ["note", "Note"],
    ], S.zoneStats);
  });
  v.append(head);

  if (!S.zoneStats) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Counting the floor…"));
    v.append(e);
    return v;
  }

  for (const kind of ["shelf", "staging", "branch"]) {
    const zs = S.zoneStats.filter(z => z.kind === kind);
    if (!zs.length) continue;
    const hr = el("div", "hr-t");
    hr.append(el("span", "sect-t",
      kind === "shelf" ? "Shelf zones"
      : kind === "branch" ? "Branch offices — not this warehouse"
      : "Staging areas — in the warehouse, not on shelves"));
    v.append(hr);
    const g = el("div", "zgrid");
    for (const z of zs) g.append(zoneCard(z));
    v.append(g);
  }
  return v;
}

function zoneCard(z) {
  const b = el("button", "zcard");
  const t = el("div", "zt");
  t.append(el("span", "zc", z.code));
  t.append(el("span", "zn", z.label || z.code));
  b.append(t);
  b.append(el("div", "zv", nf0.format(Number(z.parcels) || 0)));
  b.append(el("div", "sub2",
    z.kind === "shelf" ? "parcels on these shelves"
    : z.kind === "branch" ? "parcels waiting to be collected"
    : "parcels in this area"));

  const racks = Number(z.racks) || 0, levels = Number(z.levels) || 0;
  const slots = racks * levels, used = Number(z.locations_used) || 0;
  const cap = Number(z.capacity) || 0;
  if (slots) {
    b.append(el("div", "sub2", racks + " racks × " + levels + " levels · " +
      nf0.format(used) + " of " + nf0.format(slots) + " locations in use"));
    b.append(bar(Math.min(100, used / slots * 100), used / slots >= .9));
  } else if (cap) {
    b.append(el("div", "sub2", nf0.format(cap) + " fits here"));
    b.append(bar(Math.min(100, (Number(z.parcels) || 0) / cap * 100),
      (Number(z.parcels) || 0) / cap >= .9, true));
  }
  if (z.note) b.append(el("div", "sub2", z.note));
  /* The card counts what is actually in the zone, so the list it opens has to
     agree with it — a parcel that has gone out with a driver still carries the
     zone it was picked from, and would otherwise make the list one longer than
     the number just tapped. */
  b.onclick = () => {
    S.filters = { status: "", zone: z.code, paid: "", here: true };
    S.q = ""; S.tab = "stock";
    applyFilters();
  };
  return b;
}

function bar(pct, hot, staging) {
  const w = el("div", "zbar" + (hot ? " hot" : "") + (staging ? " stg" : ""));
  const i = el("i");
  i.style.width = pct + "%";
  w.append(i);
  return w;
}

async function loadZoneStats() {
  const { data, error } = await S.sb.rpc("zone_summary");
  if (error) { toast("Could not read the zones — " + error.message, "bad"); return; }
  S.zoneStats = data || [];
  render();
}

/* ---------------------------------------------------------------- labels --- */

function vLabels() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Labels"));
  h.append(el("div", "sub", "Printable barcode labels for zones and shipments. " +
    "Print and cut to place on shelves, containers or client goods."));
  head.append(h);
  const pr = el("button", "btn pri no-print", "Print");
  pr.style.marginLeft = "auto";
  pr.onclick = () => window.print();
  head.append(pr);
  headExport(head, () => {
    if (S.labelTab === "shipments") {
      if (!S.labelShips) { toast("Still loading the shipments.", "bad"); return; }
      writeCsv("shipment-labels", [
        [r => "SHIP-" + r.ship_num, "Barcode"], ["ship_num", "Shipment no."], ["client", "Client"],
        ["phone", "Phone"], ["mode", "Mode"], ["boxes", "Cartons"], ["weight_kg", "Weight (kg)"],
        ["volume_cbm", "Volume (CBM)"], ["arrived_at", "Received"], ["goods", "Goods"],
      ], S.labelShips);
    } else {
      writeCsv("zone-labels", [
        [r => "ZONE-" + r.code, "Barcode"], ["code", "Zone"], ["label", "Name"], ["kind", "Kind"],
      ], S.zones || []);
    }
  });
  v.append(head);

  const tabs = el("div", "lbl-tabs no-print");
  for (const t of [{ id: "zones", label: "Zone labels" }, { id: "shipments", label: "Shipment labels" }]) {
    const b = el("button", "lbl-tab" + (S.labelTab === t.id ? " on" : ""), t.label);
    b.onclick = () => {
      S.labelTab = t.id;
      if (t.id === "shipments" && !S.labelShips) loadLabelShipments();
      render();
    };
    tabs.append(b);
  }
  v.append(tabs);

  if (S.labelTab === "zones") v.append(vLabelZones());
  else v.append(vLabelShipments());
  return v;
}

function vLabelZones() {
  const f = document.createDocumentFragment();
  if (!S.zones.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "No zones"));
    e.append(document.createTextNode("Set up zones in Setup first."));
    f.append(e);
    return f;
  }
  const toolbar = el("div", "lbl-toolbar");
  const selAll = el("button", null, "Select All");
  selAll.onclick = () => { S.zones.forEach(z => S.selectedZones.add(z.code)); render(); };
  const selNone = el("button", null, "Clear");
  selNone.onclick = () => { S.selectedZones.clear(); render(); };
  const printBtn = el("button", "primary", "Print Selected");
  printBtn.disabled = S.selectedZones.size === 0;
  printBtn.onclick = () => window.print();
  const count = el("span", "lbl-count", S.selectedZones.size + " of " + S.zones.length + " selected");
  toolbar.append(selAll, selNone, printBtn, count);
  f.append(toolbar);

  const g = el("div", "lbl-grid lbl-a5");
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#141e1d";
  for (const z of S.zones) {
    const sel = S.selectedZones.has(z.code);
    const card = el("div", "lbl-card lbl-card-a5" + (S.selectedZones.size > 0 && !sel ? " lbl-unsel" : ""));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "lbl-sel";
    cb.checked = sel;
    cb.onchange = () => { if (cb.checked) S.selectedZones.add(z.code); else S.selectedZones.delete(z.code); render(); };
    card.append(cb);
    const top = el("div", "lbl-top");
    top.append(el("span", "lbl-code", z.code));
    const kindChip = el("span", "lbl-chip");
    kindChip.textContent = z.kind || "zone";
    kindChip.style.background = z.kind === "branch" ? "#7c3aed" : "var(--primary)";
    top.append(kindChip);
    card.append(top);
    card.append(el("div", "lbl-name", z.label || z.code));
    if (z.note) card.append(el("div", "lbl-info", z.note));

    const bcVal = "ZONE-" + z.code;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "zbc-" + z.code;
    card.append(svg);
    card.append(el("div", "lbl-cut", "✂ cut here · " + bcVal));
    g.append(card);
  }
  f.append(g);

  requestAnimationFrame(() => {
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#141e1d";
    for (const z of S.zones) {
      const svgEl = document.getElementById("zbc-" + z.code);
      if (!svgEl) continue;
      try {
        JsBarcode("#zbc-" + z.code, "ZONE-" + z.code, {
          format: "CODE128", width: 4, height: 120, displayValue: true,
          text: "ZONE-" + z.code, fontSize: 22, font: "IBM Plex Mono, monospace",
          textMargin: 8, margin: 8, lineColor: fg
        });
      } catch (_) {}
    }
  });
  return f;
}

function vLabelShipments() {
  const f = document.createDocumentFragment();
  if (!S.labelShips) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading shipments…"));
    f.append(e);
    return f;
  }
  if (!S.labelShips.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "No shipments yet"));
    f.append(e);
    return f;
  }

  const toolbar = el("div", "lbl-toolbar");
  const selAll = el("button", null, "Select All");
  selAll.onclick = () => { S.labelShips.forEach(s => S.selectedShips.add(s.ship_num)); render(); };
  const selNone = el("button", null, "Clear");
  selNone.onclick = () => { S.selectedShips.clear(); render(); };
  const printBtn = el("button", "primary", "Print Selected");
  printBtn.disabled = S.selectedShips.size === 0;
  printBtn.onclick = () => window.print();
  const count = el("span", "lbl-count", S.selectedShips.size + " of " + S.labelShips.length + " selected");
  toolbar.append(selAll, selNone, printBtn, count);
  f.append(toolbar);

  const g = el("div", "lbl-grid");
  for (const s of S.labelShips) {
    const sel = S.selectedShips.has(s.ship_num);
    const card = el("div", "lbl-card" + (S.selectedShips.size > 0 && !sel ? " lbl-unsel" : ""));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "lbl-sel";
    cb.checked = sel;
    cb.onchange = () => { if (cb.checked) S.selectedShips.add(s.ship_num); else S.selectedShips.delete(s.ship_num); render(); };
    card.append(cb);

    const top = el("div", "lbl-top");
    top.append(el("span", "lbl-code", "#" + s.ship_num));
    if (s.mode) {
      const chip = el("span", "lbl-chip " + s.mode, s.mode.toUpperCase());
      top.append(chip);
    }
    card.append(top);
    card.append(el("div", "lbl-name", s.client || s.code || "—"));

    const details = el("div", "lbl-details");
    function addDetail(label, val) {
      const d = el("div", "lbl-detail");
      d.append(el("span", "lbl-detail-label", label));
      d.append(el("span", "lbl-detail-val", val || "—"));
      details.append(d);
    }
    addDetail("Cartons", s.boxes != null ? String(s.boxes) : "—");
    addDetail("Received", s.arrived_at || "—");
    if (s.mode === "sea") {
      addDetail("CBM", s.volume_cbm ? Number(s.volume_cbm).toFixed(3) + " m³" : "—");
    } else {
      addDetail("Weight", s.weight_kg ? Number(s.weight_kg).toFixed(1) + " kg" : "—");
    }
    card.append(details);

    const bcVal = "SHIP-" + s.ship_num;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "sbc-" + s.ship_num;
    card.append(svg);
    card.append(el("div", "lbl-cut", "✂ cut here · " + bcVal));
    g.append(card);
  }
  f.append(g);

  requestAnimationFrame(() => {
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#141e1d";
    for (const s of S.labelShips) {
      const svgEl = document.getElementById("sbc-" + s.ship_num);
      if (!svgEl) continue;
      try {
        JsBarcode("#sbc-" + s.ship_num, "SHIP-" + s.ship_num, {
          format: "CODE128", width: 2, height: 55, displayValue: true,
          text: "SHIP-" + s.ship_num, fontSize: 12, font: "IBM Plex Mono, monospace",
          textMargin: 5, margin: 4, lineColor: fg
        });
      } catch (_) {}
    }
  });
  return f;
}

async function loadLabelShipments() {
  S.labelShips = null; render();
  const { data, error } = await S.sb.from("shipments")
    .select("ship_num,code,client,mode,goods,weight_kg,volume_cbm,boxes,arrived_at,phone,paid_at,delivered_at")
    .is("paid_at", null).is("delivered_at", null)
    .order("ship_num", { ascending: false }).limit(200);
  if (error) { toast("Could not load shipments — " + error.message, "bad"); S.labelShips = []; render(); return; }
  S.labelShips = data || [];
  render();
}

/* ----------------------------------------------------------------- money --- */
/* Office and admin only, and not merely hidden from a scanner: every function
   behind this screen refuses anyone else outright, so the figures do not exist
   for them to read. The totals and the grouping are the database's work —
   adding up eight thousand charges in a browser would be both slow and a
   second place for the arithmetic to go wrong. */

const lbp = n => S.money
  ? nf0.format(Math.round((Number(n) || 0) * (Number(S.money.lbp_rate) || 0))) + " LL"
  : "";

function vMoney() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Money"));
  h.append(el("div", "sub", "What each customer owes on goods at the hub. " +
    "Taking a payment marks their parcels paid and records who took it."));
  head.append(h);
  v.append(head);

  const m = S.money;
  if (!m) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Adding up…"));
    v.append(e);
    return v;
  }

  const tiles = el("div", "tiles");
  const tile = (k, val, note, colour) => {
    const d = el("div", "tile");
    d.append(el("div", "k", k));
    const b = el("div", "v", val);
    if (colour) b.style.color = colour;
    d.append(b);
    if (note) d.append(el("div", "n", note));
    return d;
  };
  tiles.append(
    tile("Outstanding", money(m.owed), lbp(m.owed), "var(--danger)"),
    tile("Collected", money(m.collected), lbp(m.collected), "var(--ok)"),
    tile("Unpaid parcels", nf0.format(m.unpaid_count),
      "across " + nf0.format(m.customers) + " customer" + (Number(m.customers) === 1 ? "" : "s")),
    tile("Billed", money(m.billed), nf0.format(m.billed_count) + " parcels at the hub"),
  );
  /* Not a rounding difference — parcels nobody has put a price on, which is
     money the warehouse has not asked for yet. */
  if (Number(m.unpriced_count) > 0) {
    const t = tile("Not priced yet", nf0.format(m.unpriced_count),
      "across " + nf0.format(m.unpriced_customers) + " customer" +
      (Number(m.unpriced_customers) === 1 ? "" : "s") + " — no charge set", "var(--warn)");
    tiles.append(t);
  }
  v.append(tiles);

  v.append(moneyFilters());

  if (!S.customers) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading customers…"));
    v.append(e);
    return v;
  }
  if (!S.customers.length) {
    const e = el("div", "empty");
    e.append(el("b", null, S.custOwing ? "Nobody owes anything" : "No customers"));
    e.append(document.createTextNode(S.custSearch
      ? "Nothing matches that search."
      : "Charges appear once parcels arrive and are given a price."));
    v.append(e);
    return v;
  }

  const list = el("div", "list");
  for (const c of S.customers) list.append(customerRow(c));
  v.append(list);
  v.append(custPager());

  const rates = ratesPanel();
  if (rates) v.append(rates);
  return v;
}

/* ---------------------------------------------------------- sales orders --- */
/* One wholesale client's parcels on their own, with their money. Everything for
   the client is loaded once (a couple of thousand rows), so filtering, totals
   and export are instant and always agree with each other. */
const SALES_CLIENT = "1941515";
const SALES_COLS = "barcode,name,customer,phone,shipment,status,zone,shelf,qty,weight_kg,cbm," +
  "route,cost,cny,paid,paid_at,pay_method,shipped_at,received_at,delivered_at,age_days";

async function loadSales() {
  S.soLoading = true; render();
  const rows = [];
  try {
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await S.sb.from("parcels_view").select(SALES_COLS)
        .eq("client_id", SALES_CLIENT).order("shipped_at", { ascending: false })
        .order("barcode").range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    S.soData = rows;
  } catch (e) {
    toast("Could not load the sales orders — " + ((e && e.message) || "try again"), "bad");
    if (!S.soData) S.soData = [];
  }
  S.soLoading = false;
  render();
}

function salesFiltered() {
  const free = (S.stats && S.stats.free_days) || 14;
  const long = (S.stats && S.stats.long_stay_days) || 90;
  const here = r => r.status === "received" || r.status === "shelved";
  const term = S.soQ.trim().toLowerCase();
  const bulk = S.bulk ? new Set(S.bulk.codes) : null;
  let rows = (S.soData || []).filter(r => {
    if (bulk && !bulk.has(r.barcode)) return false;
    if (S.soStatus === "in_warehouse" ? !here(r) : S.soStatus && r.status !== S.soStatus) return false;
    if (S.soPay === "unpaid" && r.paid) return false;
    if (S.soPay === "paid" && !r.paid) return false;
    if (S.soPay === "late" && !(here(r) && (Number(r.age_days) || 0) > free)) return false;
    if (S.soPay === "long" && !(here(r) && (Number(r.age_days) || 0) >= long)) return false;
    if (S.soMonth && String(r.shipped_at || "").slice(0, 7) !== S.soMonth) return false;
    if (term && ![r.barcode, r.name, r.shipment, r.shelf].some(v => String(v || "").toLowerCase().includes(term))) return false;
    return true;
  });
  const by = {
    new: (a, b) => String(b.shipped_at || "").localeCompare(String(a.shipped_at || "")),
    old: (a, b) => String(a.shipped_at || "").localeCompare(String(b.shipped_at || "")),
    cost_desc: (a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0),
    cost_asc: (a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0),
  }[S.soSort] || null;
  if (by) rows = rows.slice().sort(by);
  return rows;
}

function vSales() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Sales Orders"));
  const who = S.soData && S.soData.find(r => r.customer);
  h.append(el("div", "sub", "Every parcel for client " + SALES_CLIENT +
    (who ? " · " + who.customer : "") + ", with what is paid and what is still owed."));
  head.append(h);
  const rf = el("button", "btn sm", "Refresh");
  rf.style.marginLeft = "auto";
  rf.disabled = !!S.soLoading;
  rf.onclick = () => loadSales();
  head.append(rf);
  headExport(head, () => {
    const rows = salesFiltered();
    writeCsv("sales-orders-" + SALES_CLIENT, [
      ["barcode", "Parcel no."], ["name", "Item"], ["shipment", "Shipment"],
      [r => STATUS[r.status] || r.status, "Status"], ["zone", "Zone"], ["shelf", "Shelf"],
      [r => r.shipped_at ? String(r.shipped_at).slice(0, 10) : "", "Shipped"],
      [r => r.received_at ? String(r.received_at).slice(0, 10) : "", "Arrived"],
      ["qty", "Qty"], ["weight_kg", "Weight (kg)"], ["cbm", "Volume (CBM)"], ["route", "Route"],
      ["cost", "Charge (USD)"], ["cny", "Amount (CNY)"],
      [r => r.paid ? "Paid" : "Unpaid", "Payment"], ["pay_method", "Payment method"],
      [r => r.paid_at ? String(r.paid_at).slice(0, 10) : "", "Paid on"], ["age_days", "Days held"],
    ], rows);
  });
  v.append(head);

  if (!S.soData) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading the orders…"));
    v.append(e);
    return v;
  }

  const rows = salesFiltered();
  const sum = list => list.reduce((a, r) => a + (Number(r.cost) || 0), 0);
  const paid = rows.filter(r => r.paid), unpaid = rows.filter(r => !r.paid);
  const ll = n => (S.money ? lbp(n) : "");
  const tile = (k, val, note, colour, onclick, on) => {
    const d = el(onclick ? "button" : "div", "tile" + (on ? " on" : ""));
    if (onclick) { d.type = "button"; d.onclick = onclick; }
    d.append(el("div", "k", k));
    const b = el("div", "v", val);
    if (colour) b.style.color = colour;
    d.append(b);
    if (note) d.append(el("div", "n", note));
    return d;
  };
  const payTile = p => () => { S.soPay = S.soPay === p ? "" : p; S.soPage = 0; render(); };
  const tiles = el("div", "tiles");
  tiles.append(
    tile("Unpaid", money(sum(unpaid)), nf0.format(unpaid.length) + " parcels" + (ll(sum(unpaid)) ? " · " + ll(sum(unpaid)) : ""),
      "var(--danger)", payTile("unpaid"), S.soPay === "unpaid"),
    tile("Paid", money(sum(paid)), nf0.format(paid.length) + " parcels" + (ll(sum(paid)) ? " · " + ll(sum(paid)) : ""),
      "var(--ok)", payTile("paid"), S.soPay === "paid"),
    tile("Total", money(sum(rows)), nf0.format(rows.length) + " parcels" +
      (rows.length !== S.soData.length ? " of " + nf0.format(S.soData.length) : "")),
    tile("In the warehouse", nf0.format(rows.filter(r => r.status === "received" || r.status === "shelved").length),
      nf0.format(rows.filter(r => r.status === "expected").length) + " still on the way"),
  );
  v.append(tiles);
  v.append(bulkStrip());
  v.append(salesFilters());

  if (S.soLoading) {
    const b = el("div", "sub2");
    b.append(el("span", "spin"));
    b.append(document.createTextNode(" refreshing…"));
    b.style.marginBottom = "8px";
    v.append(b);
  }
  if (!rows.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "Nothing matches"));
    e.append(document.createTextNode("Try clearing a filter."));
    v.append(e);
    return v;
  }

  const PAGE = 100;
  const pages = Math.ceil(rows.length / PAGE);
  if (S.soPage >= pages) S.soPage = pages - 1;
  const pageRows = rows.slice(S.soPage * PAGE, S.soPage * PAGE + PAGE);
  v.append(salesSelectionHead(pageRows, rows));
  const list = el("div", "list");
  for (const r of pageRows) list.append(salesRow(r, rows));
  v.append(list);

  const w = el("div", "row");
  w.style.marginTop = "12px";
  const from = S.soPage * PAGE;
  w.append(el("span", "li-s", nf0.format(from + 1) + "–" + nf0.format(Math.min(from + PAGE, rows.length)) +
    " of " + nf0.format(rows.length)));
  const sp = el("span"); sp.style.marginLeft = "auto";
  const prev = el("button", "btn sm", "Back");
  prev.disabled = S.soPage === 0;
  prev.onclick = () => { S.soPage--; render(); };
  const next = el("button", "btn sm", "Next");
  next.disabled = S.soPage >= pages - 1;
  next.onclick = () => { S.soPage++; render(); };
  w.append(sp, prev, next);
  v.append(w);
  /* The same bulk actions as Stock: move, mark paid, export. */
  if (selCount()) v.append(bulkBar());
  return v;
}

/* Tick a page, or every parcel the filters match — the whole list is already
   here, so selecting all of it is instant. */
function salesSelectionHead(pageRows, rows) {
  const w = el("div", "selhead");
  const all = el("input");
  all.type = "checkbox";
  const codes = pageRows.map(r => r.barcode);
  const on = codes.filter(b => S.sel.has(b)).length;
  all.checked = codes.length > 0 && on === codes.length;
  all.indeterminate = on > 0 && on < codes.length;
  all.onchange = () => {
    if (all.checked) codes.forEach(b => S.sel.add(b)); else codes.forEach(b => S.sel.delete(b));
    render();
  };
  w.append(all);
  w.append(el("span", "li-s", selCount() ? nf0.format(selCount()) + " selected" : "Tick parcels to work on several at once"));
  if (rows.length > pageRows.length || (selCount() && selCount() < rows.length)) {
    const more = el("button", "btn sm", "Select all " + nf0.format(rows.length) + " matching");
    more.type = "button";
    more.style.marginLeft = "auto";
    more.onclick = () => { rows.forEach(r => S.sel.add(r.barcode)); toast(nf0.format(S.sel.size) + " selected", "ok"); render(); };
    w.append(more);
  }
  return w;
}

function salesFilters() {
  const bar = el("form", "row");
  bar.style.marginBottom = "14px";
  const q = el("input", "inp mono");
  q.placeholder = "Barcode, item, shipment or shelf…";
  q.value = S.soQ;
  q.autocomplete = "off";
  q.style.flex = "1 1 220px";
  bar.append(q);

  const sel = (opts, value, onchange) => {
    const s = el("select", "inp");
    s.style.width = "auto";
    for (const [val, label] of opts) {
      const o = el("option", null, label);
      o.value = val;
      s.append(o);
    }
    s.value = value;
    s.onchange = () => { onchange(s.value); S.soPage = 0; render(); };
    bar.append(s);
  };
  sel([["", "All statuses"], ["expected", "On the way"], ["in_warehouse", "In the warehouse"],
       ["at_branch", STATUS.at_branch], ["released", STATUS.released], ["delivered", STATUS.delivered]],
      S.soStatus, x => { S.soStatus = x; });
  const free = (S.stats && S.stats.free_days) || 14;
  const long = (S.stats && S.stats.long_stay_days) || 90;
  sel([["", "Paid & unpaid"], ["unpaid", "Unpaid only"], ["paid", "Paid only"],
       ["late", "Over " + free + " free days"], ["long", "Held " + long + "+ days"]],
      S.soPay, x => { S.soPay = x; });
  const months = [...new Set((S.soData || []).map(r => String(r.shipped_at || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  sel([["", "Every month"]].concat(months.map(m => [m, "Shipped " +
        new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" })])),
      S.soMonth, x => { S.soMonth = x; });
  sel([["new", "Newest first"], ["old", "Oldest first"], ["cost_desc", "Charge: high→low"], ["cost_asc", "Charge: low→high"]],
      S.soSort, x => { S.soSort = x; });

  const go = el("button", "btn pri", "Search");
  go.type = "submit";
  bar.append(go);
  if (S.soQ || S.soStatus || S.soPay || S.soMonth) {
    const clr = el("button", "btn", "Clear");
    clr.type = "button";
    clr.onclick = () => { S.soQ = ""; S.soStatus = ""; S.soPay = ""; S.soMonth = ""; S.soPage = 0; render(); };
    bar.append(clr);
  }
  bar.addEventListener("submit", ev => { ev.preventDefault(); S.soQ = q.value; S.soPage = 0; render(); });
  return bar;
}

function salesRow(r, rows) {
  const li = el("div", "li click rec st-" + r.status + (S.sel.has(r.barcode) ? " sel" : ""));
  li.onclick = () => openParcel(r.barcode);
  const box = el("input", "tick");
  box.type = "checkbox";
  box.checked = S.sel.has(r.barcode);
  box.onclick = ev => {
    ev.stopPropagation();
    const codes = (rows || []).map(x => x.barcode);
    const here = codes.indexOf(r.barcode);
    if (ev.shiftKey && S.lastTick != null && here >= 0) {
      const from = Math.min(S.lastTick, here), to = Math.max(S.lastTick, here);
      for (let i = from; i <= to; i++) box.checked ? S.sel.add(codes[i]) : S.sel.delete(codes[i]);
    } else {
      box.checked ? S.sel.add(r.barcode) : S.sel.delete(r.barcode);
    }
    S.lastTick = here;
    render();
  };
  li.append(box);
  const m = el("div", "li-m");
  const nm = el("div", "li-nm");
  nm.append(el("span", "mono", r.barcode), copyBtn(r.barcode));
  nm.append(el("span", "chip s-" + r.status, STATUS[r.status] || r.status));
  m.append(nm);
  const bits = [];
  if (r.name) bits.push(r.name.length > 48 ? r.name.slice(0, 48) + "…" : r.name);
  if (r.shipment) bits.push(r.shipment);
  if (r.shelf || r.zone) bits.push(r.shelf || r.zone);
  if (r.shipped_at) bits.push("shipped " + fmtDate(r.shipped_at));
  m.append(el("div", "li-s", bits.join("  ·  ")));
  li.append(m);
  const a = el("div", "li-a");
  const c = el("span", "mono num", money(r.cost));
  c.style.fontWeight = "700";
  if (!r.paid) c.style.color = "var(--danger)";
  a.append(c);
  a.append(el("span", "chip " + (r.paid ? "s-delivered" : "off"), r.paid ? "Paid" : "Unpaid"));
  li.append(a);
  return li;
}

function moneyFilters() {
  const bar = el("form", "row");
  bar.style.marginBottom = "14px";
  const q = el("input", "inp");
  q.placeholder = "Customer, client number or phone…";
  q.value = S.custSearch;
  q.autocomplete = "off";
  q.style.flex = "1 1 240px";
  bar.append(q);

  const t = el("button", "btn" + (S.custOwing ? " pri" : ""),
    S.custOwing ? "Only those who owe" : "Everyone");
  t.type = "button";
  t.onclick = () => { S.custOwing = !S.custOwing; S.custPage = 0; loadCustomers(); };
  bar.append(t);

  const go = el("button", "btn pri", "Search");
  go.type = "submit";
  bar.append(go);
  const expBtn = el("button", "btn", "Export");
  expBtn.type = "button";
  expBtn.onclick = () => exportCustomers();
  if (canExport()) bar.append(expBtn);

  bar.addEventListener("submit", ev => {
    ev.preventDefault();
    S.custSearch = q.value; S.custPage = 0; loadCustomers();
  });
  return bar;
}

function customerRow(c) {
  const li = el("div", "li");
  const m = el("div", "li-m");
  const nm = el("div", "li-nm");
  nm.append(el("span", null, c.customer || "(no name)"));
  nm.append(el("span", "chip", c.client_id));
  m.append(nm);
  const bits = [nf0.format(c.parcels) + " parcel" + (Number(c.parcels) === 1 ? "" : "s")];
  if (Number(c.unpaid)) bits.push(nf0.format(c.unpaid) + " unpaid");
  if (c.oldest_unpaid_days != null)
    bits.push("oldest held " + nf0.format(c.oldest_unpaid_days) + " days");
  if (c.phone) bits.push(c.phone);
  m.append(el("div", "li-s", bits.join("  ·  ")));
  li.append(m);

  const a = el("div", "li-a");
  const owed = Number(c.owed) || 0;
  if (owed > 0) {
    const o = el("span", "mono num", money(owed));
    o.style.fontWeight = "700";
    o.style.color = "var(--danger)";
    a.append(o);
    a.append(el("span", "li-s", lbp(owed)));
    const b = el("button", "btn sm pri", "Take payment");
    b.onclick = () => askPayment(c);
    a.append(b);
  } else {
    a.append(el("span", "chip s-delivered", "Settled"));
    a.append(el("span", "mono num li-s", money(c.total)));
  }
  const sh = el("button", "btn sm", "Parcels");
  sh.onclick = () => {
    S.q = "";
    S.filters = { status: "", zone: "", paid: "", client: c.client_id };
    S.tab = "stock";
    applyFilters();
  };
  a.append(sh);
  li.append(a);
  return li;
}

function custPager() {
  const from = S.custPage * S.custPageSize;
  const to = from + S.customers.length;
  const w = el("div", "row");
  w.style.marginTop = "12px";
  w.append(el("span", "li-s", nf0.format(from + 1) + "–" + nf0.format(to) +
    " of " + nf0.format(S.custTotal)));
  const prev = el("button", "btn sm", "Back");
  prev.disabled = S.custPage === 0;
  prev.onclick = () => { S.custPage--; loadCustomers(); };
  const next = el("button", "btn sm", "Next");
  next.disabled = to >= S.custTotal;
  next.onclick = () => { S.custPage++; loadCustomers(); };
  const sp = el("span");
  sp.style.marginLeft = "auto";
  w.append(sp, prev, next);
  return w;
}

/* The prices the charges are built from. Read-only here — changing them is a
   rates job, and changing a rate does not re-price anything already charged. */
function ratesPanel() {
  const lanes = (S.cfg && Array.isArray(S.cfg.lanes)) ? S.cfg.lanes : null;
  if (!lanes || !lanes.length) return null;
  const card = el("div", "card pad");
  card.style.marginTop = "18px";
  const hr = el("div", "hr-t");
  hr.append(el("span", "sect-t", "Rates in use"));
  card.append(hr);
  const g = el("div", "lanes");
  for (const L of lanes) {
    const r = el("div", "lane");
    r.append(el("span", "ln", L.label || L.match));
    r.append(el("span", "lm mono", L.match));
    const p = Number(L.price) || 0;
    const pv = el("span", "lp mono num",
      p ? money(p) + " / " + (L.basis === "cbm" ? "cbm" : "kg") : "not set");
    if (!p) pv.style.color = "var(--fg-faint)";
    r.append(pv);
    g.append(r);
  }
  card.append(g);
  card.append(el("div", "sub2", "1 USD = " + nf0.format(Number(S.money.lbp_rate) || 0) +
    " LL. A charge is worked out when a parcel is priced, so changing a rate " +
    "here does not move a charge already made."));

  /* show monthly CNY/USD rates */
  if (S.monthlyRates && Object.keys(S.monthlyRates).length) {
    const mrHr = el("div", "hr-t");
    mrHr.style.marginTop = "14px";
    mrHr.append(el("span", "sect-t", "Monthly CNY/USD rates"));
    card.append(mrHr);
    const mrg = el("div", "lanes");
    for (const mm of Object.keys(S.monthlyRates).sort().reverse()) {
      const r = el("div", "lane");
      r.append(el("span", "ln", mm));
      r.append(el("span", "lp mono num", S.monthlyRates[mm].toFixed(4)));
      mrg.append(r);
    }
    card.append(mrg);
  }
  return card;
}

function askPayment(c) {
  const owed = Number(c.owed) || 0;
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, "Payment from " + (c.customer || c.client_id)));
  const sub = el("p", "sub",
    money(owed) + " (" + lbp(owed) + ") across " + nf0.format(c.unpaid) +
    " parcel" + (Number(c.unpaid) === 1 ? "" : "s") + ".");
  sub.style.margin = "4px 0 16px";
  m.append(sub);

  const err = el("div");
  m.append(err);

  const f = el("label", "field");
  f.append(el("span", null, "How did they pay?"));
  const sel = el("select", "inp");
  for (const opt of PAY_METHODS) {
    const o = el("option", null, opt);
    o.value = opt;
    sel.append(o);
  }
  f.append(sel);
  m.append(f);

  m.append(banner(null, "This marks every unpaid parcel of theirs as paid",
    "Each one gets a line in its history with your name and the time."));

  const acts = el("div", "row");
  const go = el("button", "btn pri", "Mark " + money(owed) + " paid");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button";
  no.onclick = () => scrim.remove();
  acts.append(go, no);
  m.append(acts);

  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    go.disabled = true; no.disabled = true;
    go.textContent = "";
    go.append(el("span", "spin"), document.createTextNode(" Recording"));
    const { data, error } = await S.sb.rpc("take_payment", {
      p_client_id: c.client_id, p_method: sel.value,
    });
    if (error) {
      err.replaceChildren(banner("bad", "Could not record it", error.message));
      go.disabled = false; no.disabled = false;
      go.textContent = "Mark " + money(owed) + " paid";
      return;
    }
    const r = (data && data[0]) || {};
    scrim.remove();
    toast(nf0.format(r.marked || 0) + " parcel" + (Number(r.marked) === 1 ? "" : "s") +
      " marked paid · " + money(r.amount || 0), "ok");
    /* Everything downstream of a payment is now stale. */
    S.rows = null; S.stats = null;
    loadMoney(); loadCustomers();
  });

  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

async function loadMoney() {
  const { data, error } = await S.sb.rpc("money_summary");
  if (error) { toast("Could not add up the money — " + error.message, "bad"); return; }
  S.money = (data && data[0]) || null;
  render();
}

async function loadCustomers() {
  S.customers = null; render();
  const { data, error } = await S.sb.rpc("customer_balances", {
    p_only_owing: !!S.custOwing,
    p_search: S.custSearch.trim() || null,
    p_limit: S.custPageSize,
    p_offset: S.custPage * S.custPageSize,
  });
  if (error) {
    toast("Could not load the customers — " + error.message, "bad");
    S.customers = []; render(); return;
  }
  S.customers = data || [];
  S.custTotal = S.customers.length ? Number(S.customers[0].total_rows) || 0 : 0;
  if (!S.customers.length && S.custTotal > 0 && S.custPage > 0) {
    S.custPage = 0;
    return loadCustomers();
  }
  render();
}

/* The lane prices live in settings, which only office and admin may read. */
async function loadCfg() {
  if (!sees_money()) return;
  const [cfgRes, ratesRes] = await Promise.all([
    S.sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    S.sb.from("monthly_rates").select("month,cny_per_usd").order("month", { ascending: false }),
  ]);
  if (!cfgRes.error) S.cfg = (cfgRes.data && cfgRes.data.data) || null;
  if (!ratesRes.error && ratesRes.data) {
    const m = {};
    for (const r of ratesRes.data) m[r.month] = Number(r.cny_per_usd);
    S.monthlyRates = m;
  } else {
    S.monthlyRates = {};
  }
  render();
}

async function saveMonthlyRate(month, rate) {
  const { error } = await S.sb.from("monthly_rates")
    .upsert({ month, cny_per_usd: rate }, { onConflict: "month" });
  if (error) { toast(error.message, "bad"); return; }
  if (!S.monthlyRates) S.monthlyRates = {};
  S.monthlyRates[month] = rate;
  toast("Rate for " + month + " saved: " + rate, "ok");
  render();
}

async function deleteMonthlyRate(month) {
  const { error } = await S.sb.from("monthly_rates").delete().eq("month", month);
  if (error) { toast(error.message, "bad"); return; }
  if (S.monthlyRates) delete S.monthlyRates[month];
  toast("Rate for " + month + " removed", "ok");
  render();
}

function rateForMonth(dateStr) {
  if (!dateStr) return Number(S.cfg && S.cfg.cnyPerUsd) || 0;
  const month = String(dateStr).slice(0, 7);
  if (S.monthlyRates && S.monthlyRates[month]) return S.monthlyRates[month];
  return Number(S.cfg && S.cfg.cnyPerUsd) || 0;
}

async function recalcAllCosts() {
  if (!confirm("Recalculate all parcel costs using monthly rates? This may take a moment.")) return;
  const rates = S.monthlyRates || {};
  if (!Object.keys(rates).length) { toast("No monthly rates set.", "bad"); return; }
  toast("Recalculating…", "ok");
  const { data, error } = await S.sb.rpc("recalc_costs_by_monthly_rates");
  if (error) { toast(error.message, "bad"); return; }
  toast("Done! " + (data && data.updated || 0) + " parcels recalculated.", "ok");
  render();
}

/* ---------------------------------------------------------------- drawer --- */
/* One parcel, everything known about it, and whatever the person looking at it
   is allowed to do. The money lines simply are not there for a scanner — the
   view hands back nulls — and the edit form offers each role exactly the
   fields the database would accept from them, so nothing on screen is a
   button that fails. */

/* What a scanner may change, per the parcels_guard trigger. Everything else
   on this list is money or the customer, and the database refuses it. */
const SCANNER_FIELDS = ["name", "dims", "weight_kg", "cbm", "qty", "notes", "shipment"];
const OFFICE_FIELDS = SCANNER_FIELDS.concat(
  ["customer", "phone", "client_id", "cost", "cny", "declared", "pay_method"]);

const FIELD_LABEL = {
  name: "Description", dims: "Box size", weight_kg: "Weight (kg)",
  cbm: "Volume (CBM)", qty: "Quantity", notes: "Notes", shipment: "Shipment",
  customer: "Customer", phone: "Phone", client_id: "Client number",
  cost: "Charge (USD)", cny: "Dashboard amount (￥)", declared: "Declared value",
  pay_method: "Payment method",
};
const NUMERIC_FIELDS = new Set(["weight_kg", "cbm", "qty", "cost", "cny", "declared"]);

async function openParcel(barcode) {
  S.drawer = { barcode, loading: true, parcel: null, events: null, names: {} };
  render();

  const { data, error } = await S.sb.from("parcels_view").select("*")
    .eq("barcode", barcode).maybeSingle();
  if (error || !data) {
    S.drawer = null;
    toast(error ? error.message : "That parcel is no longer there", "bad");
    render();
    return;
  }
  S.drawer.parcel = data;
  S.drawer.loading = false;
  render();

  /* History second: the parcel should be on screen while this arrives. */
  const { data: ev } = await S.sb.from("parcel_events")
    .select("id,at,actor,from_status,to_status,loc,note")
    .eq("barcode", barcode).order("at", { ascending: false }).limit(60);
  const events = ev || [];
  const ids = [...new Set(events.map(e => e.actor).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: ppl } = await S.sb.from("profiles").select("id,name").in("id", ids);
    for (const p of (ppl || [])) names[p.id] = p.name;
  }
  if (S.drawer && S.drawer.barcode === barcode) {
    S.drawer.events = events;
    S.drawer.names = names;
    render();
  }
}

const closeParcel = () => {
  S.drawer = null; S._drawerShown = null; render();
  if (S.tab === "sales") loadSales();
};

function vDrawer() {
  const d = S.drawer;
  if (!d) return null;
  const scrim = el("div", "scrim" + (S._drawerShown !== d.barcode ? " enter" : ""));
  S._drawerShown = d.barcode;
  scrim.addEventListener("click", e => { if (e.target === scrim) closeParcel(); });
  const panel = el("aside", "drawer");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  if (d.loading || !d.parcel) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Opening " + d.barcode + "…"));
    panel.append(e);
    scrim.append(panel);
    return scrim;
  }

  const p = d.parcel;
  const head = el("div", "dhead");
  const dt = el("div", "dt");
  const code = el("div", "dt-code");
  code.append(el("b", "mono", p.barcode), copyBtn(p.barcode));
  dt.append(code);
  dt.append(el("span", null, p.name || "No description recorded"));
  const chips = el("div", "row");
  chips.style.marginTop = "7px";
  chips.append(el("span", "chip s-" + p.status, STATUS[p.status] || p.status));
  if (p.paid != null)
    chips.append(el("span", "chip " + (p.paid ? "s-delivered" : "off"), p.paid ? "Paid" : "Unpaid"));
  const held = p.age_days;
  const longD = (S.stats && S.stats.long_stay_days) || 90;
  const freeD = (S.stats && S.stats.free_days) || 14;
  const stillHere = p.status === "shelved" || p.status === "received";
  if (stillHere && held != null) {
    if (held >= longD) chips.append(el("span", "chip off", "here " + nf0.format(held) + " days"));
    else if (held > freeD) chips.append(el("span", "chip s-received", "over " + freeD + " free days"));
  }
  dt.append(chips);
  head.append(dt);
  const x = el("button", "btn sm", "Close");
  x.onclick = closeParcel;
  head.append(x);
  panel.append(head);

  const body = el("div", "dbody");
  const dl = el("dl", "kv");
  const kv = (k, val) => {
    if (val == null || val === "") return;
    dl.append(el("dt", null, k));
    dl.append(el("dd", null, String(val)));
  };
  kv("Shipment", p.shipment);
  kv("Customer", p.customer);
  kv("Client number", p.client_id);
  kv("Phone", p.phone);
  kv("Where", p.shelf || p.zone || "not placed");
  kv("Shipped from", p.origin);
  kv("Route", p.route);
  if (Number(p.qty)) kv("Quantity", nf0.format(p.qty));
  if (Number(p.weight_kg)) kv("Weight", nf3.format(p.weight_kg) + " kg");
  if (Number(p.cbm)) kv("Volume", nf3.format(p.cbm) + " CBM");
  kv("Box size", p.dims);

  /* Money, only if the database sent it. */
  if (p.cost != null) {
    kv("Charge", Number(p.cost) ? money(p.cost) + "  ·  " + lbpAt(p.cost) : "not priced yet");
    const lane = laneFor(p);
    if (lane) {
      const qty = lane.basis === "cbm" ? Number(p.cbm) || 0 : Number(p.weight_kg) || 0;
      const unit = lane.basis === "cbm" ? "CBM" : "kg";
      kv("Lane", (lane.label || lane.match) + "  ·  " + money(lane.price) + " per " + unit +
        (qty ? "  ×  " + nf3.format(qty) + " " + unit + "  =  " + money(laneCost(p))
             : "  (no " + unit + " recorded)"));
    }
    if (Number(p.cny)) kv("Dashboard amount", "￥" + nf2.format(p.cny));
    if (Number(p.declared)) kv("Declared value", nf2.format(p.declared));
    kv("Payment method", p.pay_method);
    if (p.paid_at) kv("Paid", fmtDate(p.paid_at));
  }

  kv("Into the China warehouse", p.inbound_at && fmtDate(p.inbound_at));
  if (p.shipped_at) {
    let s = fmtDate(p.shipped_at);
    if (p.inbound_at)
      s += "  ·  " + nf0.format(Math.round(
        (new Date(p.shipped_at) - new Date(p.inbound_at)) / 86400000)) + " days after arriving there";
    kv("Left China", s);
  }
  kv("Received here", p.received_at && fmtDate(p.received_at));
  kv("Shelved", p.shelved_at && fmtDate(p.shelved_at));
  kv("Released", p.released_at && fmtDate(p.released_at));
  kv("Delivered", p.delivered_at && fmtDate(p.delivered_at));
  if (held != null && p.status !== "expected")
    kv("Days held", nf0.format(held) + "  ·  counted from " +
      (p.shipped_at ? "when it left China" : "when it was first recorded here"));
  kv("Notes", p.notes);
  body.append(dl);

  /* ---- moving it ---- */
  body.append(el("hr", "sep"));
  const mh = el("div", "hr-t");
  mh.append(el("span", "sect-t", "Move it"));
  body.append(mh);
  const mg = el("div", "row");
  for (const s of ORDER) {
    if (s === p.status) continue;
    const b = el("button", "btn sm", "→ " + (STATUS[s] || s));
    b.onclick = () => moveFromDrawer(p, s);
    mg.append(b);
  }
  body.append(mg);
  body.append(el("div", "sub2", "Moving to a shelf is better done on the Scan screen, " +
    "where a shelf label sets where it goes."));

  /* ---- payment ---- */
  if (sees_money()) {
    body.append(el("hr", "sep"));
    const ph = el("div", "hr-t");
    ph.append(el("span", "sect-t", "Payment"));
    body.append(ph);
    const pr = el("div", "row");
    const pb = el("button", "btn sm" + (p.paid ? "" : " pri"),
      p.paid ? "Mark unpaid" : "Mark paid" + (Number(p.cost) ? " · " + money(p.cost) : ""));
    pb.onclick = () => togglePaid(p);
    pr.append(pb);
    body.append(pr);
  }

  /* ---- history ---- */
  body.append(el("hr", "sep"));
  const hh = el("div", "hr-t");
  hh.append(el("span", "sect-t", "History"));
  body.append(hh);
  const hs = el("div", "hist");
  if (!d.events) {
    const w = el("div", "sub2");
    w.append(el("span", "spin"));
    w.append(document.createTextNode(" reading the history…"));
    hs.append(w);
  } else if (!d.events.length) {
    hs.append(el("div", "sub2", "Nothing recorded yet."));
  } else {
    for (const e of d.events) {
      const r = el("div", "hi");
      r.append(el("div", "ht", fmtWhen(e.at)));
      const b = el("div", "hb");
      b.append(el("b", null, (e.from_status ? (STATUS[e.from_status] || e.from_status) + " → " : "Added as ") +
        (STATUS[e.to_status] || e.to_status || "—")));
      const bits = [];
      /* A line written before there were accounts has no name to give, and
         saying so is better than inventing one. */
      bits.push(e.actor ? (d.names[e.actor] || "someone since removed") : "before sign-in");
      if (e.loc) bits.push(e.loc);
      if (e.note) bits.push(e.note);
      b.append(el("span", null, bits.join("  ·  ")));
      r.append(b);
      hs.append(r);
    }
  }
  body.append(hs);
  panel.append(body);

  const foot = el("div", "dfoot");
  const ed = el("button", "btn pri", "Edit details");
  ed.onclick = () => askEdit(p);
  foot.append(ed);
  if (isAdmin()) {
    const del = el("button", "btn dng", "Delete");
    del.onclick = () => askDeleteParcel(p);
    foot.append(del);
  }
  const cl = el("button", "btn", "Close");
  cl.style.marginLeft = "auto";
  cl.onclick = closeParcel;
  foot.append(cl);
  panel.append(foot);

  scrim.append(panel);
  return scrim;
}

/* The lane that would price this parcel, by the same rule the warehouse uses:
   longest match on route and origin wins, and a lane priced 0 is ignored. */
function laneFor(p) {
  const lanes = (S.cfg && Array.isArray(S.cfg.lanes)) ? S.cfg.lanes : [];
  const hay = ((p.route || "") + " " + (p.origin || "")).toLowerCase();
  let best = null;
  for (const L of lanes) {
    const m = String(L.match || "").trim().toLowerCase();
    if (!m || !(Number(L.price) > 0)) continue;
    if (!hay.includes(m)) continue;
    if (!best || m.length > String(best.match).trim().length) best = L;
  }
  return best;
}
function laneCost(p) {
  const L = laneFor(p);
  if (!L) return null;
  const qty = L.basis === "cbm" ? Number(p.cbm) || 0 : Number(p.weight_kg) || 0;
  if (!qty) return null;
  return +(qty * Number(L.price)).toFixed(2);
}

const lbpAt = n => S.cfg && Number(S.cfg.lbpRate)
  ? nf0.format(Math.round((Number(n) || 0) * Number(S.cfg.lbpRate))) + " LL" : "";

function fmtWhen(iso) {
  if (!iso) return "—";
  const t = new Date(iso);
  return t.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " +
    t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function moveFromDrawer(p, to) {
  const loc = to === "at_branch"
                ? { shelf: "", zone: (theBranch() && theBranch().code) || p.zone }
            : (to === "released" || to === "delivered") ? { shelf: "" }
            : to === "expected" ? { shelf: "", zone: "" } : null;
  try {
    await moveParcel(p, to, loc, "changed from the parcel screen");
    toast("Moved to " + (STATUS[to] || to).toLowerCase(), "ok");
    S.rows = null; S.stats = null; S.zoneStats = null;
    openParcel(p.barcode);
  } catch (e) {
    toast((e && e.message) || "Could not move it", "bad");
  }
}

async function togglePaid(p) {
  const now = new Date().toISOString();
  const want = !p.paid;
  const { data, error } = await S.sb.from("parcels")
    .update(want ? { paid: true, paid_at: now } : { paid: false, paid_at: null })
    .eq("barcode", p.barcode).select("barcode");
  if (error) { toast(error.message, "bad"); return; }
  if (!data || !data.length) { toast("Nothing changed — the office handles payment.", "bad"); return; }
  await S.sb.from("parcel_events").insert({
    barcode: p.barcode, at: now, actor: S.me.id,
    from_status: p.status, to_status: p.status, loc: null,
    note: want ? "marked paid" : "marked unpaid",
  });
  toast(want ? "Marked paid" : "Marked unpaid", "ok");
  S.money = null; S.customers = null; S.rows = null; S.stats = null;
  openParcel(p.barcode);
}

function askEdit(p) {
  const fields = sees_money() ? OFFICE_FIELDS : SCANNER_FIELDS;
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, "Edit " + p.barcode));
  const sub = el("p", "sub", sees_money()
    ? "Blank a field to clear it."
    : "A scanner may correct what a parcel is, not who it is for or what it costs.");
  sub.style.margin = "4px 0 16px";
  m.append(sub);
  const err = el("div");
  m.append(err);

  const inputs = {};
  for (const k of fields) {
    const w = el("label", "field");
    w.append(el("span", null, FIELD_LABEL[k] || k));
    const i = el("input", "inp");
    i.value = p[k] == null ? "" : p[k];
    if (NUMERIC_FIELDS.has(k)) { i.type = "number"; i.step = "any"; i.min = "0"; }
    inputs[k] = i;
    w.append(i);
    m.append(w);
  }

  const acts = el("div", "row");
  const go = el("button", "btn pri", "Save");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button";
  no.onclick = () => scrim.remove();
  acts.append(go, no);
  m.append(acts);

  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    const patch = {};
    for (const k of fields) {
      const raw = inputs[k].value;
      if (NUMERIC_FIELDS.has(k)) {
        const n = raw === "" ? 0 : Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          err.replaceChildren(banner("bad", "That is not a number",
            (FIELD_LABEL[k] || k) + " needs a number, or nothing."));
          return;
        }
        patch[k] = k === "qty" ? Math.round(n) : n;
      } else {
        patch[k] = raw.trim() === "" ? null : raw.trim();
      }
    }
    go.disabled = true; no.disabled = true;
    const { data, error } = await S.sb.from("parcels")
      .update(patch).eq("barcode", p.barcode).select("barcode");
    go.disabled = false; no.disabled = false;
    if (error) {
      err.replaceChildren(banner("bad", "Could not save", error.message));
      return;
    }
    if (!data || !data.length) {
      err.replaceChildren(banner("bad", "Nothing was saved",
        "Your account may not change these."));
      return;
    }
    await S.sb.from("parcel_events").insert({
      barcode: p.barcode, at: new Date().toISOString(), actor: S.me.id,
      from_status: p.status, to_status: p.status, loc: null, note: "details edited",
    });
    scrim.remove();
    toast("Saved", "ok");
    S.rows = null; S.stats = null; S.money = null;
    openParcel(p.barcode);
  });

  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

function askDeleteParcel(p) {
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, "Delete this record?"));
  m.append(banner("bad", p.barcode + (p.name ? " — " + p.name : ""),
    "The record and its whole history go for good. The parcel itself is not affected — " +
    "if it is still on a shelf, nothing will know about it."));
  const acts = el("div", "row");
  const go = el("button", "btn dng", "Delete it");
  go.type = "submit";
  const no = el("button", "btn", "Keep it");
  no.type = "button";
  no.onclick = () => scrim.remove();
  acts.append(no, go);
  m.append(acts);
  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    go.disabled = true;
    const { error } = await S.sb.from("parcels").delete().eq("barcode", p.barcode);
    if (error) { toast(error.message, "bad"); go.disabled = false; return; }
    scrim.remove();
    closeParcel();
    toast("Record deleted", "ok");
    S.rows = null; S.stats = null; S.money = null; S.zoneStats = null;
    loadStock();
  });
  scrim.append(m);
  document.body.append(scrim);
}

/* -------------------------------------------------------------- shipping --- */
/* The other business line: clients who have their own suppliers and only ship
   with us. Their goods are consignments in containers, not parcels on
   shelves, and the price per kilo or per CBM is set by the shipping
   department in its own system — nothing here works one out. The app's job is
   to hold what that system exported, show who owes what, and record delivery
   and payment. */

const isShippingFile = headers => {
  const k = headers.map(hkey);
  return k.includes("shipnum") && (k.includes("shipcode") || k.includes("shipsr"));
};

/* Excel keeps a date as days since 30 December 1899. This sheet also uses 1
   and 0 as "not set", which must not become 1900. */
function excelDate(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.eE+-]/g, ""));
  if (!isFinite(n) || n < 10000) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

function buildShipmentRows() {
  const { headers, data } = S.imp;
  const k = headers.map(hkey);
  const at = name => k.indexOf(hkey(name));
  const num = v => {
    const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.eE+-]/g, ""));
    return isFinite(n) ? n : 0;
  };
  const txt = v => {
    const s = String(v == null ? "" : v).trim();
    return s === "" || s === "0" ? null : s;
  };

  const col = {
    ship_num: at("ship_num"), code: at("ship_code"),
    client: at("compute_0019"), mode: at("compute_0020"),
    freight: at("ship_freight_type"), container: at("ship_container_code"),
    boxes: at("ship_boxes_code"), goods: at("ship_goods_type"),
    weight: at("ship_real_weight"), volume: at("ship_real_volume"),
    price: at("ship_real_kilo_price"), fallbackPrice: at("ship_kilo_price"),
    total: at("ship_real_final_tot"), paidAmt: at("ship_payment_amt"),
    raised: at("ship_date"), arrived: at("ship_arrival_date"),
    delivered: at("ship_delivery_date"), paidAt: at("ship_payment_date"),
    to: at("ship_delv_location"), note: at("ship_note"),
  };

  const rows = [];
  let noNumber = 0, odd = [];
  for (const r of data) {
    const cell = i => (i >= 0 ? r[i] : undefined);
    const shipNum = Math.round(num(cell(col.ship_num)));
    if (!shipNum) { noNumber++; continue; }

    const code = txt(cell(col.code));
    /* The sheet usually carries the bare client name in its own column; where
       it does not, it is the part of the code after the agent. */
    let client = txt(cell(col.client));
    if (!client && code) client = code.split("-").slice(1).join("-").trim() || code;

    let mode = String(cell(col.mode) || "").trim().toLowerCase();
    if (mode !== "sea" && mode !== "air")
      mode = String(cell(col.freight) || "").trim() === "1" ? "sea" : "air";

    const weight = num(cell(col.weight));
    const volume = num(cell(col.volume));
    const price = num(cell(col.price)) || num(cell(col.fallbackPrice));
    const total = num(cell(col.total));

    /* Sea is charged on volume, air on weight. Saying so where the sheet does
       not add up means a wrong price is seen rather than quietly billed. */
    const expect = mode === "sea" ? +(volume * price).toFixed(2) : +(weight * price).toFixed(2);
    if (total && price && Math.abs(expect - total) > 0.05)
      odd.push({ ship_num: shipNum, client, mode, expect, total });

    rows.push({
      ship_num: shipNum, code, client, mode,
      container: txt(cell(col.container)),
      boxes: Math.round(num(cell(col.boxes))),
      goods: txt(cell(col.goods)),
      weight_kg: weight, volume_cbm: volume, price, total,
      paid_amount: num(cell(col.paidAmt)),
      raised_at: excelDate(cell(col.raised)),
      arrived_at: excelDate(cell(col.arrived)),
      delivered_at: excelDate(cell(col.delivered)),
      paid_at: excelDate(cell(col.paidAt)),
      delivery_to: txt(cell(col.to)),
      note: txt(cell(col.note)),
    });
  }
  return { rows, noNumber, odd };
}

function shippingImportSection() {
  const card = el("div", "card pad");
  card.style.marginTop = "18px";
  const hr = el("div", "hr-t");
  hr.append(el("span", "sect-t", "A shipping export"));
  card.append(hr);

  const { rows, noNumber, odd } = buildShipmentRows();
  const sea = rows.filter(r => r.mode === "sea").length;
  const billed = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);

  card.append(banner(null, S.imp.fileName,
    nf0.format(rows.length) + " shipments — " + nf0.format(sea) + " by sea, " +
    nf0.format(rows.length - sea) + " by air, " + money(billed) + " billed" +
    (noNumber ? ", " + nf0.format(noNumber) + " rows with no shipment number skipped" : "") + "."));

  card.append(el("div", "sub2",
    "Matched on the shipping system's own number, so bringing the same export " +
    "in again refreshes rather than duplicates. Prices come from that system — " +
    "nothing here works one out."));

  /* A total that does not match its own price and weight is worth seeing
     before it becomes an invoice. */
  if (odd.length) {
    card.append(banner("warn",
      nf0.format(odd.length) + " do not match their own price",
      "Sea is charged on volume and air on weight. These come out differently:"));
    const list = el("div", "list");
    for (const o of odd.slice(0, 8)) {
      const li = el("div", "li");
      const m = el("div", "li-m");
      const nm = el("div", "li-nm");
      nm.append(el("span", "mono", String(o.ship_num)));
      nm.append(el("span", "chip " + (o.mode === "sea" ? "office" : "scanner"), o.mode));
      m.append(nm);
      m.append(el("div", "li-s", (o.client || "—") + " · the sheet says " +
        money(o.total) + ", the price works out to " + money(o.expect)));
      li.append(m);
      list.append(li);
    }
    card.append(list);
  }

  const acts = el("div", "row");
  acts.style.marginTop = "12px";
  const go = el("button", "btn pri", S.shipRunning
    ? "Bringing them in… " + nf0.format(S.shipDone || 0)
    : "Bring in " + nf0.format(rows.length) + " shipments");
  go.type = "button";
  go.disabled = !rows.length || !!S.shipRunning;
  go.onclick = () => runShipmentImport(rows);
  acts.append(go);
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  cancel.disabled = !!S.shipRunning;
  cancel.onclick = () => { S.imp = null; S.shipResult = null; render(); };
  acts.append(cancel);
  card.append(acts);

  if (S.shipResult)
    card.append(banner("ok", "Done", nf0.format(S.shipResult.inserted) + " added, " +
      nf0.format(S.shipResult.updated) + " refreshed."));
  return card;
}

async function runShipmentImport(rows) {
  S.shipRunning = true; S.shipDone = 0; S.shipResult = null; render();
  let inserted = 0, updated = 0;
  try {
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300);
      const { data, error } = await S.sb.rpc("import_shipments", { p_rows: chunk });
      if (error) throw error;
      const r = (data && data[0]) || {};
      inserted += Number(r.inserted) || 0;
      updated += Number(r.updated) || 0;
      S.shipDone = Math.min(i + chunk.length, rows.length);
      render();
    }
    S.shipResult = { inserted, updated };
    S.imp = null;
    S.ships = null; S.shipStats = null;
    toast(nf0.format(inserted) + " added, " + nf0.format(updated) + " refreshed", "ok");
  } catch (e) {
    toast("Stopped after " + nf0.format(S.shipDone) + " — " +
      ((e && e.message) || "something went wrong"), "bad");
  }
  S.shipRunning = false;
  render();
}

/* ------------------------------------------------------------ the screen --- */
function vShipping() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Shipping"));
  h.append(el("div", "sub", "Clients who ship with us but buy from their own suppliers. " +
    "Priced by the shipping department, per CBM by sea and per kilo by air."));
  head.append(h);
  v.append(head);
  v.append(bulkStrip());

  const s = S.shipStats;
  const tiles = el("div", "tiles");
  const tile = (k, label, val, note, on, colour) => {
    const b = el("button", "tile" + (on ? " on" : ""));
    b.append(el("div", "k", label));
    const vv = el("div", "v", val);
    if (colour) vv.style.color = colour;
    b.append(vv);
    if (note) b.append(el("div", "n", note));
    b.onclick = () => {
      const f = S.shipFilters;
      if (!k) S.shipFilters = { mode: "", paid: "" };
      else if (k === "sea" || k === "air")
        S.shipFilters = { ...f, mode: f.mode === k ? "" : k };
      else S.shipFilters = { ...f, paid: f.paid === k ? "" : k };
      loadShipments(); loadShipStats();
    };
    return b;
  };
  if (!s) {
    const b = el("div", "tile");
    b.append(el("div", "k", "Adding up"), el("div", "v", "…"));
    tiles.append(b);
  } else {
    const f = S.shipFilters;
    const n = x => nf0.format(Number(x) || 0);
    const narrowed = Number(s.shipments) !== Number(s.total_all);
    tiles.append(
      tile("", "Shipments", n(s.shipments),
        narrowed ? "of " + n(s.total_all) + " in all" : n(s.clients) + " clients · " +
          n(s.containers) + " containers", !f.mode && !f.paid),
      tile("sea", "By sea", n(s.sea), "charged per CBM", f.mode === "sea"),
      tile("air", "By air", n(s.air), "charged per kilo", f.mode === "air"),
      tile("unpaid", "Outstanding", money(s.outstanding), n(s.unpaid_count) + " unpaid",
        f.paid === "unpaid", "var(--danger)"),
      tile("", "Collected", money(s.collected), "of " + money(s.billed) + " billed", false,
        "var(--ok)"),
      tile("undelivered", "Not delivered", n(s.undelivered), "still to go out",
        f.paid === "undelivered"),
    );
  }
  v.append(tiles);

  /* search */
  const bar = el("form", "row");
  bar.style.marginBottom = "14px";
  const q = el("input", "inp");
  q.placeholder = "Client, container or shipment number…";
  q.value = S.shipQ;
  q.autocomplete = "off";
  q.style.flex = "1 1 240px";
  bar.append(q);
  const go = el("button", "btn pri", "Search");
  go.type = "submit";
  bar.append(go);
  if (S.shipQ.trim() || S.shipFilters.mode || S.shipFilters.paid) {
    const clr = el("button", "btn", "Clear");
    clr.type = "button";
    clr.onclick = () => {
      S.shipQ = ""; S.shipFilters = { mode: "", paid: "" };
      loadShipments(); loadShipStats();
    };
    bar.append(clr);
  }
  bar.addEventListener("submit", ev => {
    ev.preventDefault();
    S.shipQ = q.value;
    loadShipments(); loadShipStats();
  });
  v.append(bar);

  /* date filter + sort + export row */
  const toolRow = el("div", "row");
  toolRow.style.marginBottom = "14px"; toolRow.style.gap = "8px"; toolRow.style.flexWrap = "wrap";
  const dateInp = el("input", "inp");
  dateInp.type = "date"; dateInp.value = S.shipDate;
  dateInp.style.width = "auto";
  dateInp.onchange = () => { S.shipDate = dateInp.value; loadShipments(); loadShipStats(); };
  toolRow.append(dateInp);
  if (S.shipDate) {
    const dc = el("button", "btn", "Clear date");
    dc.onclick = () => { S.shipDate = ""; loadShipments(); loadShipStats(); };
    toolRow.append(dc);
  }
  const sortSel = el("select", "inp");
  sortSel.style.width = "auto";
  sortSel.innerHTML = '<option value="">Sort: recent</option><option value="desc">Amount: high→low</option><option value="asc">Amount: low→high</option>';
  sortSel.value = S.shipSort;
  sortSel.onchange = () => { S.shipSort = sortSel.value; loadShipments(); };
  toolRow.append(sortSel);
  const expBtn = el("button", "btn", "Export");
  expBtn.onclick = () => exportShipments();
  if (canExport()) toolRow.append(expBtn);
  v.append(toolRow);

  if (!S.ships) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading shipments…"));
    v.append(e);
    return v;
  }
  if (!S.ships.length) {
    const e = el("div", "empty");
    e.append(el("b", null, s && Number(s.total_all) ? "Nothing matches" : "No shipments yet"));
    e.append(document.createTextNode(s && Number(s.total_all)
      ? "Clear the filter, or search for something else."
      : "Bring the shipping department's export in from Setup."));
    v.append(e);
    return v;
  }

  /* select all / bulk actions */
  const selBar = el("div", "row");
  selBar.style.marginBottom = "8px"; selBar.style.gap = "8px"; selBar.style.alignItems = "center";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.checked = S.ships.length > 0 && S.ships.every(r => S.shipSel.has(r.ship_num));
  allCb.onchange = () => {
    if (allCb.checked) S.ships.forEach(r => S.shipSel.add(r.ship_num));
    else S.shipSel.clear();
    render();
  };
  selBar.append(allCb);
  selBar.append(el("span", "li-s", S.shipSel.size
    ? S.shipSel.size + " selected"
    : "Select all"));
  if (S.shipSel.size) {
    const bulkDel = el("button", "btn sm pri", "Mark delivered");
    bulkDel.onclick = () => shipBulkDelivered();
    selBar.append(bulkDel);
    const bulkPaid = el("button", "btn sm", "Mark paid");
    bulkPaid.style.background = "var(--ok)"; bulkPaid.style.color = "#fff";
    bulkPaid.style.borderColor = "var(--ok)";
    bulkPaid.onclick = () => shipBulkPaid();
    selBar.append(bulkPaid);
  }
  v.append(selBar);

  const list = el("div", "list");
  for (const r of S.ships) list.append(shipmentRow(r));
  v.append(list);
  return v;
}

function shipmentRow(r) {
  const li = el("div", "li");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = S.shipSel.has(r.ship_num);
  cb.style.marginRight = "10px"; cb.style.flexShrink = "0";
  cb.onchange = () => {
    if (cb.checked) S.shipSel.add(r.ship_num);
    else S.shipSel.delete(r.ship_num);
    render();
  };
  li.append(cb);
  const m = el("div", "li-m");
  const nm = el("div", "li-nm");
  nm.append(el("span", null, r.client || r.code || "—"));
  nm.append(el("span", "chip " + (r.mode === "sea" ? "office" : "scanner"),
    r.mode === "sea" ? "Sea" : "Air"));
  if (r.container) nm.append(el("span", "chip", r.container));
  if (!r.delivered_at) nm.append(el("span", "chip s-received", "not delivered"));
  if (r.shelf || r.zone) nm.append(el("span", "chip s-shelved", "at " + (r.shelf || r.zone)));
  m.append(nm);

  const bits = ["#" + r.ship_num];
  const qty = r.mode === "sea"
    ? nf3.format(Number(r.volume_cbm) || 0) + " CBM"
    : nf3.format(Number(r.weight_kg) || 0) + " kg";
  bits.push(qty + " × " + money(r.price) + (r.mode === "sea" ? "/CBM" : "/kg"));
  if (Number(r.boxes)) bits.push(nf0.format(r.boxes) + " boxes");
  if (r.goods) bits.push(r.goods);
  if (r.raised_at) bits.push("raised " + fmtDate(r.raised_at));
  m.append(el("div", "li-s", bits.join("  ·  ")));
  li.append(m);

  const a = el("div", "li-a");
  const total = Number(r.total) || 0, paid = Number(r.paid_amount) || 0;
  const owed = +(total - paid).toFixed(2);
  const t = el("span", "mono num", money(total));
  t.style.fontWeight = "700";
  a.append(t);
  if (r.paid_at && owed <= 0) {
    a.append(el("span", "chip s-delivered", "Paid"));
    const ub = el("button", "btn sm", "Mark unpaid");
    ub.style.fontSize = "11px";
    ub.onclick = () => markShipment(r, { unpaid: true });
    a.append(ub);
  } else {
    const o = el("span", "chip off", money(owed) + " due");
    a.append(o);
    const b = el("button", "btn sm pri", "Mark paid");
    b.onclick = () => markShipment(r, { paid: true });
    a.append(b);
  }
  if (r.delivered_at) {
    a.append(el("span", "li-s", "delivered " + fmtDate(r.delivered_at)));
    const ud = el("button", "btn sm", "Undo delivered");
    ud.style.fontSize = "11px";
    ud.onclick = () => markShipment(r, { undeliver: true });
    a.append(ud);
  } else {
    const d = el("button", "btn sm", "Delivered");
    d.onclick = () => markShipment(r, { delivered: true });
    a.append(d);
  }
  if (r.delivery_to === "waseet") {
    a.append(el("span", "chip s-released", "With Waseet"));
    const undo = el("button", "btn sm", "Undo");
    undo.style.fontSize = "11px";
    undo.onclick = () => undoShipWaseet(r);
    a.append(undo);
  } else {
    const w = el("button", "btn sm", "→ Waseet");
    w.style.background = "var(--accent, #8e44ad)"; w.style.color = "#fff";
    w.style.borderColor = "var(--accent, #8e44ad)";
    w.onclick = () => sendShipToWaseet(r);
    a.append(w);
  }
  li.append(a);
  return li;
}

async function markShipment(r, what) {
  const today = new Date().toISOString().slice(0, 10);
  const patch = {};
  if (what.paid) { patch.paid_at = today; patch.paid_amount = Number(r.total) || 0; }
  if (what.unpaid) { patch.paid_at = null; patch.paid_amount = 0; }
  if (what.delivered) patch.delivered_at = today;
  if (what.undeliver) patch.delivered_at = null;
  const { data, error } = await S.sb.from("shipments")
    .update(patch).eq("ship_num", r.ship_num).select("ship_num");
  if (error) { toast(error.message, "bad"); return; }
  if (!data || !data.length) { toast("Nothing changed — the office handles this.", "bad"); return; }
  toast(what.paid ? "Marked paid · " + money(r.total) : what.unpaid ? "Marked unpaid" : what.undeliver ? "Delivery undone" : "Marked delivered", "ok");
  loadShipments(); loadShipStats();
}

async function sendShipToWaseet(r) {
  const { error } = await S.sb.from("shipments")
    .update({ delivery_to: "waseet" })
    .eq("ship_num", r.ship_num);
  if (error) { toast(error.message, "bad"); return; }
  toast("Shipment #" + r.ship_num + " sent to Waseet for delivery", "ok");
  loadShipments(); loadShipStats();
}

async function undoShipWaseet(r) {
  const { error } = await S.sb.from("shipments")
    .update({ delivery_to: null })
    .eq("ship_num", r.ship_num);
  if (error) { toast(error.message, "bad"); return; }
  toast("Shipment #" + r.ship_num + " removed from Waseet", "ok");
  loadShipments(); loadShipStats();
}

async function shipBulkDelivered() {
  const nums = [...S.shipSel];
  if (!nums.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await S.sb.from("shipments")
    .update({ delivered_at: today })
    .in("ship_num", nums);
  if (error) { toast(error.message, "bad"); return; }
  toast(nf0.format(nums.length) + " shipments marked delivered", "ok");
  S.shipSel.clear();
  loadShipments(); loadShipStats();
}

async function shipBulkPaid() {
  const nums = [...S.shipSel];
  if (!nums.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const matched = S.ships.filter(r => S.shipSel.has(r.ship_num));
  const updates = matched.map(r => S.sb.from("shipments")
    .update({ paid_at: today, paid_amount: Number(r.total) || 0 })
    .eq("ship_num", r.ship_num));
  const results = await Promise.all(updates);
  const errs = results.filter(r => r.error);
  if (errs.length) { toast(errs[0].error.message, "bad"); return; }
  toast(nf0.format(nums.length) + " shipments marked paid", "ok");
  S.shipSel.clear();
  loadShipments(); loadShipStats();
}

async function loadShipments() {
  S.ships = null; render();
  const f = S.shipFilters;
  let qy = S.sb.from("shipments").select(
    "ship_num,code,client,mode,container,boxes,goods,weight_kg,volume_cbm," +
    "price,total,paid_amount,raised_at,arrived_at,delivered_at,paid_at,delivery_to,zone,shelf");
  qy = bulkShipFilter(qy);
  if (f.mode) qy = qy.eq("mode", f.mode);
  if (f.paid === "unpaid") qy = qy.is("paid_at", null);
  if (f.paid === "paid") qy = qy.not("paid_at", "is", null);
  if (f.paid === "undelivered") qy = qy.is("delivered_at", null);
  if (S.shipDate) qy = qy.eq("arrived_at", S.shipDate);
  const term = S.shipQ.trim();
  if (term) {
    const like = "%" + term.replace(/[%,()]/g, " ") + "%";
    const parts = ["client.ilike." + like, "code.ilike." + like,
                   "container.ilike." + like];
    if (/^\d+$/.test(term)) parts.push("ship_num.eq." + term);
    qy = qy.or(parts.join(","));
  }
  if (S.shipSort === "asc") qy = qy.order("total", { ascending: true });
  else if (S.shipSort === "desc") qy = qy.order("total", { ascending: false });
  else qy = qy.order("raised_at", { ascending: false });
  const { data, error } = await qy.order("ship_num", { ascending: false }).limit(300);
  if (error) { toast(error.message, "bad"); S.ships = []; render(); return; }
  S.ships = data || [];
  render();
}

async function loadShipStats() {
  const f = S.shipFilters;
  const { data, error } = await S.sb.rpc("shipment_summary", {
    p_search: S.shipQ.trim() || null,
    p_mode: f.mode || null,
    p_paid: f.paid || null,
  });
  if (error) { toast("Could not add up the shipping — " + error.message, "bad"); return; }
  S.shipStats = (data && data[0]) || null;
  render();
}

/* ------------------------------------------------------ export shipments --- */
async function exportShipments() {
  if (!S.ships || !S.ships.length) { toast("Nothing to export.", "bad"); return; }
  const cols = ["ship_num", "code", "client", "mode", "container", "boxes", "goods",
    "weight_kg", "volume_cbm", "price", "total", "paid_amount", "raised_at",
    "arrived_at", "delivered_at", "paid_at"];
  const HEAD = { ship_num: "Shipment #", code: "Code", client: "Client", mode: "Mode",
    container: "Container", boxes: "Boxes", goods: "Goods", weight_kg: "Weight (kg)",
    volume_cbm: "Volume (CBM)", price: "Price", total: "Total", paid_amount: "Paid",
    raised_at: "Raised", arrived_at: "Arrived", delivered_at: "Delivered", paid_at: "Paid date" };
  const csv = [cols.map(c => csvCell(HEAD[c] || c)).join(",")]
    .concat(S.ships.map(r => cols.map(c => csvCell(r[c])).join(",")))
    .join("\n");
  const name = "shipments-" + (S.shipDate || new Date().toISOString().slice(0, 10)) + ".csv";
  if (offerFile(name, csv)) toast(nf0.format(S.ships.length) + " shipments exported", "ok");
  else toast("The browser would not save the file.", "bad");
}

/* ------------------------------------------------------- export customers --- */
async function exportCustomers() {
  if (!S.customers || !S.customers.length) { toast("Nothing to export.", "bad"); return; }
  const cols = ["client_id", "customer", "phone", "parcels", "unpaid", "owed", "total",
    "oldest_unpaid_days"];
  const HEAD = { client_id: "Client #", customer: "Customer", phone: "Phone",
    parcels: "Parcels", unpaid: "Unpaid", owed: "Owed (USD)", total: "Total (USD)",
    oldest_unpaid_days: "Oldest held (days)" };
  const csv = [cols.map(c => csvCell(HEAD[c] || c)).join(",")]
    .concat(S.customers.map(r => cols.map(c => csvCell(r[c])).join(",")))
    .join("\n");
  const name = "customers-" + new Date().toISOString().slice(0, 10) + ".csv";
  if (offerFile(name, csv)) toast(nf0.format(S.customers.length) + " customers exported", "ok");
  else toast("The browser would not save the file.", "bad");
}

/* ------------------------------------------------------------ summary --- */
function vSummary() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Summary"));
  h.append(el("div", "sub", "Financial overview — app clients and shipping clients received in Lebanon."));
  head.append(h);
  v.append(head);

  /* date filter */
  const toolRow = el("div", "row");
  toolRow.style.marginBottom = "14px"; toolRow.style.gap = "8px"; toolRow.style.flexWrap = "wrap";
  const dateInp = el("input", "inp");
  dateInp.type = "date"; dateInp.value = S.summaryDate;
  dateInp.style.width = "auto";
  dateInp.onchange = () => { S.summaryDate = dateInp.value; loadSummary(); };
  toolRow.append(dateInp);
  if (S.summaryDate) {
    const dc = el("button", "btn", "Clear date");
    dc.onclick = () => { S.summaryDate = ""; loadSummary(); };
    toolRow.append(dc);
  }
  const expBtn = el("button", "btn", "Export");
  expBtn.onclick = () => exportSummary();
  if (canExport()) toolRow.append(expBtn);
  v.append(toolRow);

  const m = S.money;
  const ss = S.shipStats;
  const sd = S.summaryData;

  if (!sd) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Adding up…"));
    v.append(e);
    return v;
  }

  const tiles = el("div", "tiles");
  const tile = (k, val, note, colour) => {
    const d = el("div", "tile");
    d.append(el("div", "k", k));
    const b = el("div", "v", val);
    if (colour) b.style.color = colour;
    d.append(b);
    if (note) d.append(el("div", "n", note));
    return d;
  };

  tiles.append(
    tile("App clients owed", money(sd.app_owed), nf0.format(sd.app_unpaid_count || 0) + " unpaid parcels", "var(--danger)"),
    tile("App clients collected", money(sd.app_collected), nf0.format(sd.app_customers || 0) + " customers", "var(--ok)"),
    tile("Shipping owed", money(sd.ship_outstanding), nf0.format(sd.ship_unpaid_count || 0) + " unpaid shipments", "var(--danger)"),
    tile("Shipping collected", money(sd.ship_collected), nf0.format(sd.ship_clients || 0) + " clients", "var(--ok)"),
  );
  v.append(tiles);

  const totals = el("div", "tiles");
  totals.style.marginTop = "8px";
  const grandOwed = (Number(sd.app_owed) || 0) + (Number(sd.ship_outstanding) || 0);
  const grandCollected = (Number(sd.app_collected) || 0) + (Number(sd.ship_collected) || 0);
  totals.append(
    tile("Total outstanding", money(grandOwed), "app + shipping combined", "var(--danger)"),
    tile("Total collected", money(grandCollected), "app + shipping combined", "var(--ok)"),
    tile("Received in Lebanon", nf0.format(sd.received_count || 0), "parcels at the hub"),
  );
  v.append(totals);
  return v;
}

async function loadSummary() {
  S.summaryData = null; render();
  const dateFilter = S.summaryDate || null;
  const promises = [];

  let appQy = S.sb.from("parcels_view")
    .select("cost,paid", { count: "exact" })
    .not("status", "in", "(expected)");
  if (dateFilter) appQy = appQy.eq("shipped_at", dateFilter);
  promises.push(appQy);

  let shipQy = S.sb.from("shipments")
    .select("total,paid_amount,paid_at,arrived_at");
  if (dateFilter) shipQy = shipQy.eq("arrived_at", dateFilter);
  promises.push(shipQy);

  let rcvQy = S.sb.from("parcels_view")
    .select("barcode", { count: "exact" })
    .in("status", ["received", "shelved", "at_branch", "released"]);
  if (dateFilter) rcvQy = rcvQy.eq("shipped_at", dateFilter);
  promises.push(rcvQy);

  try {
    const [appRes, shipRes, rcvRes] = await Promise.all([appQy, shipQy, rcvQy]);
    const appRows = appRes.data || [];
    const shipRows = shipRes.data || [];

    let appOwed = 0, appCollected = 0, appUnpaid = 0, appCustomers = new Set();
    for (const r of appRows) {
      const c = Number(r.cost) || 0;
      if (r.paid) appCollected += c;
      else { appOwed += c; appUnpaid++; }
    }

    let shipOutstanding = 0, shipCollected = 0, shipUnpaid = 0, shipClients = new Set();
    for (const r of shipRows) {
      const t = Number(r.total) || 0, p = Number(r.paid_amount) || 0;
      if (r.paid_at) shipCollected += p;
      else { shipOutstanding += +(t - p).toFixed(2); shipUnpaid++; }
    }

    S.summaryData = {
      app_owed: appOwed, app_collected: appCollected,
      app_unpaid_count: appUnpaid, app_customers: appRows.length,
      ship_outstanding: shipOutstanding, ship_collected: shipCollected,
      ship_unpaid_count: shipUnpaid, ship_clients: shipRows.length,
      received_count: rcvRes.count || 0,
    };
  } catch (e) {
    toast("Could not load summary — " + (e.message || "try again"), "bad");
    S.summaryData = {};
  }
  render();
}

function exportSummary() {
  const sd = S.summaryData;
  if (!sd) { toast("Nothing to export.", "bad"); return; }
  const rows = [
    ["Category", "Outstanding (USD)", "Collected (USD)", "Count"],
    ["App clients", sd.app_owed, sd.app_collected, sd.app_unpaid_count],
    ["Shipping clients", sd.ship_outstanding, sd.ship_collected, sd.ship_unpaid_count],
    ["Total", (Number(sd.app_owed) || 0) + (Number(sd.ship_outstanding) || 0),
     (Number(sd.app_collected) || 0) + (Number(sd.ship_collected) || 0), ""],
    ["", "", "", ""],
    ["Received in Lebanon", sd.received_count, "", ""],
  ];
  const csv = rows.map(r => r.map(csvCell).join(",")).join("\n");
  const name = "summary-" + (S.summaryDate || new Date().toISOString().slice(0, 10)) + ".csv";
  if (offerFile(name, csv)) toast("Summary exported", "ok");
  else toast("The browser would not save the file.", "bad");
}

/* ------------------------------------------------------------- waseet --- */
function vWaseet() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Waseet"));
  h.append(el("div", "sub", "Cash-on-delivery parcels with Waseet. " +
    "Waseet takes parcels, delivers them, and collects the shipping cash from clients. You collect that money from Waseet."));
  head.append(h);
  v.append(head);
  v.append(bulkStrip());

  /* search bar */
  const searchBar = el("form", "row");
  searchBar.style.marginBottom = "14px";
  const wq = el("input", "inp");
  wq.placeholder = "Phone, barcode, client ID or name…";
  wq.value = S.waseetQ;
  wq.autocomplete = "off";
  wq.style.flex = "1 1 240px";
  searchBar.append(wq);
  const wgo = el("button", "btn pri", "Search");
  wgo.type = "submit";
  searchBar.append(wgo);
  if (S.waseetQ.trim()) {
    const wclr = el("button", "btn", "Clear");
    wclr.type = "button";
    wclr.onclick = () => { S.waseetQ = ""; loadWaseet(); };
    searchBar.append(wclr);
  }
  searchBar.addEventListener("submit", ev => {
    ev.preventDefault();
    S.waseetQ = wq.value;
    loadWaseet();
  });
  v.append(searchBar);

  /* date filter + export */
  const toolRow = el("div", "row");
  toolRow.style.marginBottom = "14px"; toolRow.style.gap = "8px"; toolRow.style.flexWrap = "wrap";
  const dateInp = el("input", "inp");
  dateInp.type = "date"; dateInp.value = S.waseetDate;
  dateInp.style.width = "auto";
  dateInp.onchange = () => { S.waseetDate = dateInp.value; loadWaseet(); };
  toolRow.append(dateInp);
  if (S.waseetDate) {
    const dc = el("button", "btn", "Clear date");
    dc.onclick = () => { S.waseetDate = ""; loadWaseet(); };
    toolRow.append(dc);
  }
  const sortSel = el("select", "inp");
  sortSel.style.width = "auto";
  sortSel.innerHTML = '<option value="desc">Amount: high→low</option><option value="asc">Amount: low→high</option>';
  sortSel.value = S.waseetSort;
  sortSel.onchange = () => { S.waseetSort = sortSel.value; loadWaseet(); };
  toolRow.append(sortSel);
  const expBtn = el("button", "btn", "Export");
  expBtn.onclick = () => exportWaseet();
  if (canExport()) toolRow.append(expBtn);
  v.append(toolRow);

  if (!S.waseetData || !S.waseetShips) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading Waseet data…"));
    v.append(e);
    return v;
  }

  const rows = S.waseetData;
  const wShips = S.waseetShips || [];
  if (!rows.length && !wShips.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "Nothing with Waseet"));
    e.append(document.createTextNode("Release parcels or send shipments to Waseet for delivery."));
    v.append(e);
    return v;
  }

  /* totals — only count unpaid parcels in the Waseet balance;
     parcels whose client already paid the warehouse are not owed by Waseet */
  let totalOwed = 0, totalPaid = 0, unpaidCount = 0;
  for (const r of rows) {
    const c = Number(r.cost) || 0;
    if (!r.paid) { totalOwed += c; unpaidCount++; }
    else totalPaid += c;
  }
  let shipOwed = 0, shipPaidAmt = 0, shipUnpaid = 0;
  for (const s of wShips) {
    const t = Number(s.total) || 0, p = Number(s.paid_amount) || 0;
    const owed = +(t - p).toFixed(2);
    if (!s.paid_at || owed > 0) { shipOwed += owed > 0 ? owed : t; shipUnpaid++; }
    else shipPaidAmt += t;
  }

  const tiles = el("div", "tiles");
  const tile = (k, val, note, colour) => {
    const d = el("div", "tile");
    d.append(el("div", "k", k));
    const b = el("div", "v", val);
    if (colour) b.style.color = colour;
    d.append(b);
    if (note) d.append(el("div", "n", note));
    return d;
  };
  const orderIds = new Set();
  for (const r of rows) if (r.client_id) orderIds.add(r.client_id);
  for (const s of wShips) orderIds.add("ship-" + s.ship_num);
  tiles.append(
    tile("Collect from Waseet", money(totalOwed + shipOwed),
      nf0.format(unpaidCount) + " parcels + " + nf0.format(shipUnpaid) + " shipments", "var(--danger)"),
    tile("Already paid direct", money(totalPaid + shipPaidAmt), "client paid — not with Waseet", "var(--ok)"),
    tile("Total Orders", nf0.format(orderIds.size), "unique clients + shipments"),
    tile("Total with Waseet", nf0.format(rows.length + wShips.length),
      nf0.format(rows.length) + " parcels · " + nf0.format(wShips.length) + " shipments"),
  );
  v.append(tiles);

  /* select all / clear */
  const selBar = el("div", "row");
  selBar.style.marginBottom = "8px"; selBar.style.gap = "8px"; selBar.style.alignItems = "center";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.checked = rows.length > 0 && rows.every(r => S.waseetSel.has(r.barcode));
  allCb.onchange = () => {
    if (allCb.checked) rows.forEach(r => S.waseetSel.add(r.barcode));
    else S.waseetSel.clear();
    render();
  };
  selBar.append(allCb);
  const selOrders = new Set();
  for (const r of rows) if (S.waseetSel.has(r.barcode)) selOrders.add(r.client_id || r.barcode);
  selBar.append(el("span", "li-s", selOrders.size
    ? selOrders.size + " orders selected (" + S.waseetSel.size + " parcels)"
    : "Select all"));
  if (S.waseetSel.size) {
    const delBtn = el("button", "btn sm", "Remove selected");
    delBtn.style.background = "var(--danger)"; delBtn.style.color = "#fff";
    delBtn.style.borderColor = "var(--danger)";
    delBtn.onclick = () => waseetRemoveSelected();
    selBar.append(delBtn);
    const markPaid = el("button", "btn sm pri", "Mark paid");
    markPaid.onclick = () => waseetMarkPaid();
    selBar.append(markPaid);
    const markUnpaid = el("button", "btn sm", "Mark unpaid");
    markUnpaid.style.background = "var(--warning, #e67e22)"; markUnpaid.style.color = "#fff";
    markUnpaid.style.borderColor = "var(--warning, #e67e22)";
    markUnpaid.onclick = () => waseetMarkUnpaid();
    selBar.append(markUnpaid);
  }
  v.append(selBar);

  /* parcel list — grouped by client_id */
  const groups = new Map();
  for (const r of rows) {
    const key = r.client_id || r.barcode;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const list = el("div", "list");
  for (const [cid, parcels] of groups) {
    const first = parcels[0];
    let grpOwed = 0, grpTotal = 0;
    for (const p of parcels) { const c = Number(p.cost) || 0; grpTotal += c; if (!p.paid) grpOwed += c; }

    /* group header */
    const ghdr = el("div", "li");
    ghdr.style.cursor = "pointer"; ghdr.style.fontWeight = "600";
    ghdr.style.borderLeft = "3px solid var(--accent, #3498db)";
    const gcb = document.createElement("input");
    gcb.type = "checkbox";
    gcb.checked = parcels.every(p => S.waseetSel.has(p.barcode));
    gcb.style.marginRight = "10px"; gcb.style.flexShrink = "0";
    gcb.onclick = (ev) => ev.stopPropagation();
    gcb.onchange = () => {
      if (gcb.checked) parcels.forEach(p => S.waseetSel.add(p.barcode));
      else parcels.forEach(p => S.waseetSel.delete(p.barcode));
      render();
    };
    ghdr.append(gcb);
    const gm = el("div", "li-m");
    const gnm = el("div", "li-nm");
    gnm.append(el("span", null, first.customer || cid));
    if (first.client_id) gnm.append(el("span", "chip", first.client_id));
    gnm.append(el("span", "chip", nf0.format(parcels.length) + (parcels.length === 1 ? " parcel" : " parcels")));
    gm.append(gnm);
    if (first.phone) gm.append(el("div", "li-s", first.phone));
    ghdr.append(gm);
    const ga = el("div", "li-a");
    const gt = el("span", "mono num", money(grpOwed));
    gt.style.fontWeight = "700";
    if (grpOwed > 0) gt.style.color = "var(--danger)";
    ga.append(gt);
    ghdr.append(ga);

    const detail = el("div");
    detail.style.paddingLeft = "20px";
    detail.style.display = S.waseetOpen && S.waseetOpen.has(cid) ? "block" : "none";
    ghdr.onclick = () => {
      if (!S.waseetOpen) S.waseetOpen = new Set();
      if (S.waseetOpen.has(cid)) S.waseetOpen.delete(cid);
      else S.waseetOpen.add(cid);
      detail.style.display = S.waseetOpen.has(cid) ? "block" : "none";
    };

    for (const r of parcels) {
      const li = el("div", "li");
      li.style.paddingLeft = "8px";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = S.waseetSel.has(r.barcode);
      cb.style.marginRight = "10px"; cb.style.flexShrink = "0";
      cb.onclick = (ev) => ev.stopPropagation();
      cb.onchange = () => {
        if (cb.checked) S.waseetSel.add(r.barcode);
        else S.waseetSel.delete(r.barcode);
        render();
      };
      li.append(cb);
      const m = el("div", "li-m");
      const nm = el("div", "li-nm");
      nm.append(el("span", "mono", r.barcode), copyBtn(r.barcode));
      nm.append(el("span", "chip " + (r.paid ? "s-delivered" : "off"), r.paid ? "Paid" : "Unpaid"));
      m.append(nm);
      li.append(m);
      const a = el("div", "li-a");
      const cost = Number(r.cost) || 0;
      const c = el("span", "mono num", money(cost));
      c.style.fontWeight = "600";
      if (!r.paid) c.style.color = "var(--danger)";
      a.append(c);
      li.append(a);
      detail.append(li);
    }
    list.append(ghdr);
    list.append(detail);
  }
  v.append(list);

  /* shipping items sent to Waseet */
  if (wShips.length) {
    v.append(el("h3", null, "Shipping with Waseet"));
    const sList = el("div", "list");
    for (const s of wShips) {
      const li = el("div", "li");
      const m = el("div", "li-m");
      const nm = el("div", "li-nm");
      nm.append(el("span", null, s.client || s.code || "—"));
      nm.append(el("span", "chip office", "Shipping #" + s.ship_num));
      nm.append(el("span", "chip " + (s.mode === "sea" ? "office" : "scanner"),
        s.mode === "sea" ? "Sea" : "Air"));
      if (s.paid_at) nm.append(el("span", "chip s-delivered", "Paid"));
      else nm.append(el("span", "chip off", "Unpaid"));
      m.append(nm);
      const bits = [];
      if (s.phone) bits.push(s.phone);
      if (s.arrived_at) bits.push("arrived " + fmtDate(s.arrived_at));
      if (bits.length) m.append(el("div", "li-s", bits.join("  ·  ")));
      li.append(m);
      const a = el("div", "li-a");
      const total = Number(s.total) || 0;
      const c = el("span", "mono num", money(total));
      c.style.fontWeight = "600";
      if (!s.paid_at) c.style.color = "var(--danger)";
      a.append(c);
      const rb = el("button", "btn sm", "Return");
      rb.style.fontSize = "11px";
      rb.onclick = async () => {
        const { error } = await S.sb.from("shipments")
          .update({ delivery_to: null }).eq("ship_num", s.ship_num);
        if (error) { toast(error.message, "bad"); return; }
        toast("Shipment #" + s.ship_num + " removed from Waseet", "ok");
        loadWaseet();
      };
      a.append(rb);
      const db = el("button", "btn sm pri", "Delivered");
      db.style.fontSize = "11px";
      db.onclick = async () => {
        const today = new Date().toISOString().slice(0, 10);
        const { error } = await S.sb.from("shipments")
          .update({ delivered_at: today }).eq("ship_num", s.ship_num);
        if (error) { toast(error.message, "bad"); return; }
        toast("Shipment #" + s.ship_num + " marked delivered", "ok");
        loadWaseet();
      };
      a.append(db);
      li.append(a);
      sList.append(li);
    }
    v.append(sList);
  }

  return v;
}

async function loadWaseet() {
  S.waseetData = null; S.waseetShips = null; render();
  const wTerm = S.waseetQ.trim();
  const wLike = wTerm ? "%" + wTerm.replace(/[%,()]/g, " ") + "%" : null;

  let qy = (S.bulk ? S.sb.rpc("parcels_by_barcodes", { p_codes: S.bulk.codes }) : S.sb.from("parcels_view"))
    .select("barcode,name,client_id,customer,phone,cost,paid,status,updated_at")
    .eq("status", "released");
  if (S.waseetDate) qy = qy.eq("shipped_at", S.waseetDate);
  if (wLike) {
    qy = qy.or(["phone.ilike." + wLike, "barcode.ilike." + wLike,
                 "client_id.ilike." + wLike, "customer.ilike." + wLike].join(","));
  }
  qy = qy.order("cost", { ascending: S.waseetSort === "asc" });

  let sq = S.sb.from("shipments")
    .select("ship_num,code,client,mode,total,paid_at,paid_amount,delivered_at,arrived_at,phone")
    .eq("delivery_to", "waseet").is("delivered_at", null);
  sq = bulkShipFilter(sq);
  if (S.waseetDate) sq = sq.eq("arrived_at", S.waseetDate);
  if (wLike) {
    sq = sq.or(["client.ilike." + wLike, "code.ilike." + wLike,
                "ship_num::text.ilike." + wLike].join(","));
  }
  sq = sq.order("total", { ascending: S.waseetSort === "asc" });

  const [pRes, sRes] = await Promise.all([qy.limit(500), sq.limit(200)]);
  if (pRes.error) { toast(pRes.error.message, "bad"); S.waseetData = []; S.waseetShips = []; render(); return; }
  if (sRes.error) { toast(sRes.error.message, "bad"); }
  S.waseetData = pRes.data || [];
  S.waseetShips = sRes.data || [];
  render();
}

async function waseetRemoveSelected() {
  const codes = [...S.waseetSel];
  if (!codes.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await S.sb.from("parcels")
    .update({ status: "delivered", delivered_at: today + "T00:00:00Z" })
    .in("barcode", codes);
  if (error) { toast(error.message, "bad"); return; }
  toast(nf0.format(codes.length) + " marked delivered and removed from Waseet", "ok");
  S.waseetSel.clear();
  loadWaseet();
}

async function waseetMarkPaid() {
  const codes = [...S.waseetSel];
  if (!codes.length) return;
  const { error } = await S.sb.from("parcels")
    .update({ paid: true })
    .in("barcode", codes);
  if (error) { toast(error.message, "bad"); return; }
  toast(nf0.format(codes.length) + " marked paid", "ok");
  S.waseetSel.clear();
  loadWaseet();
}

async function waseetMarkUnpaid() {
  const codes = [...S.waseetSel];
  if (!codes.length) return;
  const { error } = await S.sb.from("parcels")
    .update({ paid: false })
    .in("barcode", codes);
  if (error) { toast(error.message, "bad"); return; }
  toast(nf0.format(codes.length) + " marked unpaid", "ok");
  S.waseetSel.clear();
  loadWaseet();
}

function exportWaseet() {
  if (!S.waseetData || !S.waseetData.length) { toast("Nothing to export.", "bad"); return; }
  const cols = ["barcode", "customer", "client_id", "phone", "cost", "paid"];
  const HEAD = { barcode: "Barcode", customer: "Customer", client_id: "Client #",
    phone: "Phone", cost: "Amount (USD)", paid: "Paid" };
  const csv = [cols.map(c => csvCell(HEAD[c] || c)).join(",")]
    .concat(S.waseetData.map(r => cols.map(c => csvCell(r[c])).join(",")))
    .join("\n");
  const name = "waseet-" + (S.waseetDate || new Date().toISOString().slice(0, 10)) + ".csv";
  if (offerFile(name, csv)) toast(nf0.format(S.waseetData.length) + " rows exported", "ok");
  else toast("The browser would not save the file.", "bad");
}

/* ----------------------------------------------------------------- setup --- */
/* Rates, storage rules and the floor plan. Office may look — the figures are
   the ones behind every charge, and hiding them from the people taking money
   would be unhelpful — but only an admin may change anything, and that is the
   database's rule, not this screen's. The controls are disabled for office
   because an enabled button that silently does nothing is worse than no
   button. */

const DEFAULT_CFG = {
  whName: BRAND, whSub: BRAND_SUB,
  currency: "USD", lbpRate: 89500, freeDays: 14, cnyPerUsd: 6.1,
  rateMode: "cbm", ratePerCbm: 450, ratePerKg: 14.5, longStayDays: 90,
  lanes: [],
};

/* Backups. The database copies itself every night at 3am (Beirut) and keeps
   seven nights; this button gives the admin a copy to keep somewhere else. */
function backupCard() {
  const card = el("div", "card pad");
  card.style.marginBottom = "14px";
  const r = el("div", "row");
  const t = el("div");
  t.style.flex = "1 1 260px";
  t.append(el("b", null, "Backups"));
  t.append(el("div", "li-s", "Saved automatically every night at 3am, last 7 nights kept. " +
    "Download a full copy now and then and keep it on your computer or a USB stick."));
  r.append(t);
  const b = el("button", "btn", S.backupBusy ? "Preparing…" : "Download full backup");
  b.disabled = !!S.backupBusy;
  b.onclick = async () => {
    S.backupBusy = true; render();
    /* One table at a time keeps each request short. */
    const data = { taken_at: new Date().toISOString(), project: "baghdedi-warehouse" };
    for (const t of ["parcels", "parcel_events", "shipments", "zones", "monthly_rates", "profiles", "settings"]) {
      const { data: rows, error } = await S.sb.rpc("backup_table", { p_table: t });
      if (error) { S.backupBusy = false; render(); toast("Could not back up " + t + " — " + error.message, "bad"); return; }
      data[t] = rows || [];
    }
    S.backupBusy = false; render();
    const name = "warehouse-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    if (offerFile(name, JSON.stringify(data), "application/json"))
      toast("Backup downloaded: " + nf0.format((data.parcels || []).length) + " parcels", "ok");
  };
  r.append(b);
  card.append(r);
  return card;
}

function vSetup() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Setup"));
  h.append(el("div", "sub", isAdmin()
    ? "Rates, storage rules and the floor plan."
    : "Rates, storage rules and the floor plan. Only an admin can change these."));
  head.append(h);
  headExport(head, () => {
    const rows = (S.zones || []).map(z => ({
      section: "Floor plan", key: z.code, name: z.label, value: z.kind,
      detail: [z.racks ? z.racks + " racks" : "", z.levels ? z.levels + " levels" : "",
               z.capacity ? "fits " + z.capacity : "", z.note || ""].filter(Boolean).join(" · "),
    }));
    for (const m of Object.keys(S.monthlyRates || {}).sort())
      rows.push({ section: "CNY per USD", key: m, name: "", value: S.monthlyRates[m], detail: "" });
    writeCsv("setup", [["section", "Section"], ["key", "Code / month"], ["name", "Name"],
                       ["value", "Kind / rate"], ["detail", "Details"]], rows);
  });
  v.append(head);
  if (isAdmin()) v.append(backupCard());

  if (!S.cfg) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading the settings…"));
    v.append(e);
    return v;
  }
  if (!isAdmin())
    v.append(banner(null, "You can see these but not change them",
      "Rates and the floor plan are an admin's to set."));

  /* The draft is what the inputs are bound to, so a half-finished edit
     survives a re-render and nothing is written until Save. */
  if (!S.cfgDraft) S.cfgDraft = { ...DEFAULT_CFG, ...S.cfg };
  const d = S.cfgDraft;
  const ro = !isAdmin();

  const card = el("div", "card pad");
  const sec = t => {
    const hr = el("div", "hr-t");
    hr.append(el("span", "sect-t", t));
    card.append(hr);
  };
  const grid = () => {
    const g = el("div", "g2");
    g.style.marginTop = "10px";
    card.append(g);
    return g;
  };
  const fld = (g, k, label, hint, type) => {
    const w = el("label", "field");
    w.append(el("span", null, label));
    const i = el("input", "inp");
    i.value = d[k] == null ? "" : d[k];
    i.disabled = ro;
    if (type === "number") { i.type = "number"; i.step = "any"; i.min = "0"; }
    i.oninput = () => { d[k] = type === "number" ? i.value : i.value; };
    w.append(i);
    if (hint) w.append(el("div", "sub2", hint));
    g.append(w);
  };

  sec("Warehouse");
  let g = grid();
  fld(g, "whName", "Name");
  fld(g, "whSub", "Subtitle");

  sec("Storage rules");
  g = grid();
  fld(g, "freeDays", "Free storage days",
    "After this, a parcel counts as over its free time.", "number");
  fld(g, "longStayDays", "“Here too long” after (days)",
    "The pile worth chasing.", "number");

  sec("Currency");
  g = grid();
  fld(g, "lbpRate", "1 USD in Lebanese pounds", "Used only for display.", "number");
  fld(g, "cnyPerUsd", "Yuan per 1 USD", "Fallback when no monthly rate is set.", "number");

  /* monthly rates editor */
  sec("Monthly CNY/USD rates");
  g = grid();
  const mrNote = el("div", "sub2");
  mrNote.textContent = "Set a rate per month. During import, parcels use the rate of their shipped month. If no monthly rate is set, the fallback above is used.";
  g.append(mrNote);
  const mrTable = el("div");
  mrTable.style.display = "grid"; mrTable.style.gridTemplateColumns = "auto auto auto";
  mrTable.style.gap = "6px 10px"; mrTable.style.alignItems = "center"; mrTable.style.marginTop = "10px";
  mrTable.append(el("b", null, "Month")); mrTable.append(el("b", null, "Rate")); mrTable.append(el("b", null, ""));
  const rates = S.monthlyRates || {};
  const sortedMonths = Object.keys(rates).sort().reverse();
  for (const mm of sortedMonths) {
    mrTable.append(el("span", "mono", mm));
    const rInp = el("input", "inp");
    rInp.type = "number"; rInp.step = "0.0001"; rInp.value = rates[mm];
    rInp.style.width = "100px";
    rInp.disabled = ro;
    rInp.onchange = () => saveMonthlyRate(mm, Number(rInp.value));
    mrTable.append(rInp);
    if (!ro) {
      const del = el("button", "btn sm", "×");
      del.style.color = "var(--danger)"; del.style.padding = "2px 8px";
      del.onclick = () => deleteMonthlyRate(mm);
      mrTable.append(del);
    } else {
      mrTable.append(el("span"));
    }
  }
  g.append(mrTable);
  if (!ro) {
    const addRow = el("div", "row");
    addRow.style.marginTop = "10px"; addRow.style.gap = "8px"; addRow.style.alignItems = "center";
    const mInp = el("input", "inp");
    mInp.type = "month"; mInp.style.width = "auto";
    addRow.append(mInp);
    const rInp = el("input", "inp");
    rInp.type = "number"; rInp.step = "0.0001"; rInp.placeholder = "Rate";
    rInp.style.width = "100px";
    addRow.append(rInp);
    const addBtn = el("button", "btn sm pri", "Add");
    addBtn.onclick = async () => {
      const month = mInp.value;
      const rate = Number(rInp.value);
      if (!month || !rate) { toast("Pick a month and enter a rate.", "bad"); return; }
      await saveMonthlyRate(month, rate);
    };
    addRow.append(addBtn);
    g.append(addRow);

    const recalcBtn = el("button", "btn pri", "Recalculate all parcel costs");
    recalcBtn.style.marginTop = "10px";
    recalcBtn.onclick = recalcAllCosts;
    g.append(recalcBtn);
    const recalcNote = el("div", "sub2");
    recalcNote.textContent = "Re-applies each monthly rate to every parcel based on its shipped month.";
    g.append(recalcNote);
  }

  sec("Fallback rate");
  g = grid();
  const mw = el("label", "field");
  mw.append(el("span", null, "Work a charge out from"));
  const ms = el("select", "inp");
  for (const [val, lab] of [["cbm", "Volume — per CBM"], ["kg", "Weight — per kg"],
                            ["manual", "Enter it by hand"]]) {
    const o = el("option", null, lab);
    o.value = val;
    if ((d.rateMode || "cbm") === val) o.selected = true;
    ms.append(o);
  }
  ms.disabled = ro;
  ms.onchange = () => { d.rateMode = ms.value; };
  mw.append(ms);
  mw.append(el("div", "sub2", "Used only when no lane below matches."));
  g.append(mw);
  fld(g, "ratePerCbm", "Rate per CBM (USD)", null, "number");
  fld(g, "ratePerKg", "Rate per kg (USD)", null, "number");

  card.append(lanesSection());
  v.append(card);

  const acts = el("div", "row");
  acts.style.marginTop = "14px";
  const save = el("button", "btn pri", S.cfgSaving ? "Saving…" : "Save settings");
  save.disabled = ro || !!S.cfgSaving;
  save.onclick = saveCfg;
  acts.append(save);
  if (!ro) {
    const undo = el("button", "btn", "Discard changes");
    undo.onclick = () => { S.cfgDraft = null; S.laneCover = null; render(); };
    acts.append(undo);
  }
  v.append(acts);

  v.append(zonesSection());
  v.append(importSection());

  const foot = el("div", "sub2");
  foot.style.cssText = "margin-top:18px;text-align:center";
  foot.append(document.createTextNode("Running version " + versionLabel() + ". "));
  const again = el("button", "btn sm", "Check for a new one");
  again.onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
      toast("Checked. If a new version was waiting it will offer to reload.", "ok");
    } catch (_) { toast("Could not check — reload the page instead.", "bad"); }
  };
  foot.append(again);
  v.append(foot);
  return v;
}

function lanesSection() {
  const wrap = el("div");
  const hr = el("div", "hr-t");
  hr.append(el("span", "sect-t", "Price per lane"));
  wrap.append(hr);
  const p = el("div", "sub2");
  p.style.margin = "8px 0 10px";
  p.textContent = "A parcel is matched on what its route says, and the most specific match " +
    "wins — “Air Cargo Hk” beats “Air Cargo”, whatever order they are in. A price of 0 " +
    "means the lane is ignored and the fallback rate above is used instead.";
  wrap.append(p);

  const d = S.cfgDraft;
  if (!Array.isArray(d.lanes)) d.lanes = [];
  const ro = !isAdmin();

  const tbl = el("div", "lanetbl");
  const hd = el("div", "lanehd");
  for (const t of ["Lane", "Route contains", "Priced by", "USD", "Parcels", ""])
    hd.append(el("div", null, t));
  tbl.append(hd);

  d.lanes.forEach((L, i) => {
    const row = el("div", "lanerow");
    const mk = (key, ph, type) => {
      const inp = el("input", "inp");
      inp.value = L[key] == null ? "" : L[key];
      inp.placeholder = ph || "";
      inp.disabled = ro;
      if (type === "number") { inp.type = "number"; inp.step = "any"; inp.min = "0"; }
      inp.oninput = () => { L[key] = inp.value; if (key === "match") S.laneCover = null; };
      row.append(inp);
      return inp;
    };
    mk("label", "name it");
    mk("match", "Air Cargo Hk");
    const bs = el("select", "inp");
    for (const [val, lab] of [["kg", "per kg"], ["cbm", "per CBM"]]) {
      const o = el("option", null, lab);
      o.value = val;
      if ((L.basis === "cbm" ? "cbm" : "kg") === val) o.selected = true;
      bs.append(o);
    }
    bs.disabled = ro;
    bs.onchange = () => { L.basis = bs.value; };
    row.append(bs);
    mk("price", "0", "number");

    /* What this lane would actually take. Absent means none — the database
       only returns the lanes that matched something. */
    const cov = S.laneCover ? (S.laneCover[i] || 0) : null;
    const c = el("div", "mono num");
    c.textContent = cov == null ? "—" : nf0.format(cov);
    if (cov === 0) { c.style.color = "var(--warn)"; c.title = "matches nothing"; }
    row.append(c);

    const del = el("button", "btn sm", "Remove");
    del.type = "button";
    del.disabled = ro;
    del.onclick = () => { d.lanes.splice(i, 1); S.laneCover = null; render(); };
    row.append(del);
    tbl.append(row);
  });
  wrap.append(tbl);

  if (S.laneCover && S.laneCover["-1"] != null)
    wrap.append(banner(Number(S.laneCover["-1"]) ? "warn" : null,
      nf0.format(S.laneCover["-1"]) + " parcels match no lane at all",
      Number(S.laneCover["-1"])
        ? "Those fall back to the rate above. Add a lane for them, or leave them to it."
        : "Every parcel is covered."));

  const row = el("div", "row");
  row.style.marginTop = "9px";
  const add = el("button", "btn sm", "Add a lane");
  add.type = "button";
  add.disabled = ro;
  add.onclick = () => {
    d.lanes.push({ label: "", match: "", basis: "kg", price: 0 });
    S.laneCover = null;
    render();
  };
  row.append(add);
  const chk = el("button", "btn sm", S.coverBusy ? "Counting…" : "Count what each lane takes");
  chk.type = "button";
  chk.disabled = !!S.coverBusy;
  chk.onclick = checkLaneCoverage;
  row.append(chk);
  wrap.append(row);
  return wrap;
}

async function checkLaneCoverage() {
  S.coverBusy = true; render();
  const lanes = (S.cfgDraft && S.cfgDraft.lanes) || [];
  const { data, error } = await S.sb.rpc("lane_coverage", { p_lanes: lanes });
  S.coverBusy = false;
  if (error) { toast("Could not count the lanes — " + error.message, "bad"); render(); return; }
  const by = {};
  for (const r of (data || [])) by[r.idx] = Number(r.matched) || 0;
  /* A lane that matched nothing is simply absent, so fill the gaps with zero
     rather than leaving them looking un-counted. */
  lanes.forEach((_, i) => { if (by[i] == null) by[i] = 0; });
  if (by["-1"] == null) by["-1"] = 0;
  S.laneCover = by;
  render();
}

async function saveCfg() {
  if (!isAdmin()) return;
  const d = S.cfgDraft;
  const num = (v, fallback) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : fallback;
  };
  const body = {
    ...S.cfg,
    whName: String(d.whName || "").trim() || DEFAULT_CFG.whName,
    whSub: String(d.whSub || "").trim(),
    currency: "USD",
    freeDays: Math.round(num(d.freeDays, 14)),
    longStayDays: Math.round(num(d.longStayDays, 90)),
    lbpRate: num(d.lbpRate, 89500),
    cnyPerUsd: num(d.cnyPerUsd, 6.1),
    rateMode: ["cbm", "kg", "manual"].includes(d.rateMode) ? d.rateMode : "cbm",
    ratePerCbm: num(d.ratePerCbm, 0),
    ratePerKg: num(d.ratePerKg, 0),
    lanes: (d.lanes || [])
      .map(L => ({
        label: String(L.label || "").trim(),
        match: String(L.match || "").trim(),
        basis: L.basis === "cbm" ? "cbm" : "kg",
        price: num(L.price, 0),
      }))
      .filter(L => L.match || L.label),
  };

  S.cfgSaving = true; render();
  const { data, error } = await S.sb.from("settings")
    .update({ data: body, updated_at: new Date().toISOString() })
    .eq("id", 1).select("data");
  S.cfgSaving = false;

  if (error) { toast("Could not save — " + error.message, "bad"); render(); return; }
  /* An update the rules disallow does not fail, it changes nothing — so what
     came back is checked rather than assumed. */
  if (!data || !data.length) {
    toast("Nothing was saved — only an admin may change the settings.", "bad");
    render();
    return;
  }
  S.cfg = data[0].data;
  S.cfgDraft = null;
  loadBrand();                     /* the header follows the rename at once */
  S.stats = null; S.money = null;   /* free days and the rate feed those */
  toast("Settings saved", "ok");
  render();
}

/* ----------------------------------------------------------------- zones --- */
function zonesSection() {
  const card = el("div", "card pad");
  card.style.marginTop = "18px";
  const hr = el("div", "hr-t");
  hr.append(el("span", "sect-t", "Floor plan"));
  card.append(hr);
  const p = el("div", "sub2");
  p.style.margin = "8px 0 10px";
  p.textContent = "Shelf zones have racks and levels, and a scan is refused if it points " +
    "past them. Staging areas just hold things.";
  card.append(p);

  const list = el("div", "list");
  for (const z of S.zones) {
    const li = el("div", "li");
    const m = el("div", "li-m");
    const nm = el("div", "li-nm");
    nm.append(el("span", "zc", z.code));
    nm.append(el("span", null, z.label || z.code));
    if (z.kind === "staging") nm.append(el("span", "chip", "staging"));
    if (z.kind === "branch") nm.append(el("span", "chip admin", "branch office"));
    m.append(nm);
    const bits = [];
    if (z.kind === "shelf" && z.racks && z.levels)
      bits.push(z.racks + " racks × " + z.levels + " levels");
    if (z.capacity) bits.push("fits " + nf0.format(z.capacity));
    if (z.note) bits.push(z.note);
    m.append(el("div", "li-s", bits.join("  ·  ") || "—"));
    li.append(m);
    if (isAdmin()) {
      const e = el("button", "btn sm", "Edit");
      e.onclick = () => askZone(z);
      li.append(e);
    }
    list.append(li);
  }
  card.append(list);

  if (isAdmin()) {
    const row = el("div", "row");
    row.style.marginTop = "10px";
    const add = el("button", "btn sm", "Add a zone");
    add.onclick = () => askZone(null);
    row.append(add);
    card.append(row);
  }
  return card;
}

function askZone(z) {
  const isNew = !z;
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, isNew ? "Add a zone" : "Zone " + z.code));
  const err = el("div");
  err.style.marginTop = "10px";
  m.append(err);

  const f = {};
  const fld = (k, label, val, ph, type, hint) => {
    const w = el("label", "field");
    w.append(el("span", null, label));
    const i = el("input", "inp");
    i.value = val == null ? "" : val;
    i.placeholder = ph || "";
    if (type === "number") { i.type = "number"; i.min = "0"; i.step = "1"; }
    if (k === "code" && !isNew) i.disabled = true;
    f[k] = i;
    w.append(i);
    if (hint) w.append(el("div", "sub2", hint));
    m.append(w);
    return i;
  };
  fld("code", "Code", z && z.code, "A", null,
    isNew ? "Short, and the start of every shelf label in it — A1-01-03 is zone A."
          : "A zone's code cannot change: the parcels on its shelves refer to it.");
  fld("label", "Name", z && z.label, "Zone A");

  const kw = el("label", "field");
  kw.append(el("span", null, "Type"));
  const ks = el("select", "inp");
  for (const [val, lab] of [["shelf", "Shelf zone — parcels get a shelf code"],
                            ["staging", "Staging area — inside the warehouse, no shelves"],
                            ["branch", "Branch office — not this warehouse; customers collect there"]]) {
    const o = el("option", null, lab);
    o.value = val;
    if ((z ? z.kind : "shelf") === val) o.selected = true;
    ks.append(o);
  }
  kw.append(ks);
  m.append(kw);

  fld("racks", "Racks", z && z.racks, "10", "number", "Shelf zones only.");
  fld("levels", "Levels per rack", z && z.levels, "5", "number");
  fld("capacity", "Capacity", z && z.capacity, "300", "number", "Staging areas only.");
  fld("note", "Note", z && z.note, "heavy and bulky goods");

  const acts = el("div", "row");
  acts.style.marginTop = "4px";
  const go = el("button", "btn pri", isNew ? "Add it" : "Save");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button";
  no.onclick = () => scrim.remove();
  acts.append(go, no);
  if (!isNew) {
    const del = el("button", "btn dng", "Delete");
    del.type = "button";
    del.style.marginLeft = "auto";
    del.onclick = () => removeZone(z, scrim, err);
    acts.append(del);
  }
  m.append(acts);

  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    const code = String(f.code.value || "").trim().toUpperCase();
    if (!code) {
      err.replaceChildren(banner("bad", "A code is needed", "Even one letter will do."));
      return;
    }
    const kind = ks.value;
    const n = v => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : null; };
    const body = {
      code,
      label: String(f.label.value || "").trim() || code,
      kind,
      racks: kind === "shelf" ? n(f.racks.value) : null,
      levels: kind === "shelf" ? n(f.levels.value) : null,
      capacity: n(f.capacity.value) || 0,
      note: String(f.note.value || "").trim() || null,
      sort: z ? z.sort : (S.zones.length + 1),
    };
    go.disabled = true; no.disabled = true;
    const q = isNew
      ? S.sb.from("zones").insert(body).select("code")
      : S.sb.from("zones").update(body).eq("code", z.code).select("code");
    const { data, error } = await q;
    go.disabled = false; no.disabled = false;
    if (error) {
      err.replaceChildren(banner("bad", "Could not save the zone",
        /duplicate|unique/i.test(error.message)
          ? "There is already a zone with that code." : error.message));
      return;
    }
    if (!data || !data.length) {
      err.replaceChildren(banner("bad", "Nothing was saved",
        "Only an admin may change the floor plan."));
      return;
    }
    scrim.remove();
    toast(isNew ? "Zone " + code + " added" : "Zone " + code + " saved", "ok");
    S.zoneStats = null;
    loadZones();
  });

  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
}

async function removeZone(z, scrim, err) {
  /* A zone with parcels in it should not vanish under them. */
  const { count } = await S.sb.from("parcels_view")
    .select("barcode", { count: "exact", head: true }).eq("zone", z.code);
  if (count) {
    err.replaceChildren(banner("bad", "Zone " + z.code + " still has " +
      nf0.format(count) + " parcel" + (count === 1 ? "" : "s") + " in it",
      "Move them somewhere else first, then delete the zone."));
    return;
  }
  const { error } = await S.sb.from("zones").delete().eq("code", z.code);
  if (error) {
    err.replaceChildren(banner("bad", "Could not delete it", error.message));
    return;
  }
  scrim.remove();
  toast("Zone " + z.code + " deleted", "ok");
  S.zoneStats = null;
  loadZones();
}

/* ---------------------------------------------------------------- import --- */
/* The weekly dashboard export, brought in. An .xlsx is a zip of XML, and the
   browser can already inflate and decode both, so this reads one directly
   rather than pulling in a spreadsheet library the size of the whole app.
   Everything here only prepares rows — the merge itself is one call to the
   database, where it is atomic and where the rules about what may overwrite
   what are written down once. */

/* ------------------------------------------------------------- the zip --- */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  /* The end-of-central-directory record sits at the back, after a comment of
     unknown length, so scan backwards for its signature. */
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 65558; i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That does not look like an .xlsx file.");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    const localAt = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    /* The local header repeats the name and carries its own extra field,
       whose length can differ from the central directory's. */
    const lNameLen = dv.getUint16(localAt + 26, true);
    const lExtraLen = dv.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(start, start + compSize);
    /* Only the few parts that hold the sheet are worth inflating. */
    if (/^xl\/(worksheets\/sheet1\.xml|sharedStrings\.xml)$/.test(name))
      out.set(name, method === 0 ? raw : await inflateRaw(raw));
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

const xmlDecode = s => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, "&");          /* last, or real ampersands double-decode */

/* "B12" -> 1. Column letters are base-26 with A = 1. */
function columnIndex(ref) {
  const letters = ref.match(/^([A-Z]+)/)[1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(file) {
  const zip = await unzip(await file.arrayBuffer());
  const dec = new TextDecoder();
  const sheet = zip.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("No first sheet in that file.");
  const ssFile = zip.get("xl/sharedStrings.xml");
  const strings = [];
  if (ssFile) {
    const xml = dec.decode(ssFile);
    for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
      let s = "";
      for (const t of (m[1] || "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += t[1];
      strings.push(xmlDecode(s));
    }
  }
  const xml = dec.decode(sheet);
  const rows = [];
  for (const rm of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || "";
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || "n";
      let v = "";
      if (type === "inlineStr") {
        for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) v += t[1];
        v = xmlDecode(v);
      } else {
        const vm = body.match(/<v>([\s\S]*?)<\/v>/);
        const raw = vm ? vm[1] : "";
        v = type === "s" ? (strings[+raw] ?? "") : xmlDecode(raw);
      }
      if (ref) row[columnIndex(ref)] = v; else row.push(v);
    }
    rows.push(row);
  }
  return rows;
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  const t = String(text).replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') { q = true; }
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n") {
      row.push(cell); cell = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

/* --------------------------------------------------------- the columns --- */
const IMPORT_FIELDS = [
  ["barcode", "Barcode / order no."], ["name", "Item name"], ["clientId", "Client ID"],
  ["customer", "Client name"], ["phone", "Phone"], ["parcel", "Shipment"],
  ["itemId", "Item ID"], ["qty", "Quantity"],
  ["weightKg", "Weight (kg)"], ["cbm", "Volume (CBM)"],
  ["lenCm", "Length (cm)"], ["widCm", "Width (cm)"], ["hgtCm", "Height (cm)"],
  ["sizeLWH", "Box size (L×W×H)"],
  ["cny", "Amount (￥)"], ["cost", "Charge (USD)"], ["declared", "Declared value"],
  ["origin", "Origin warehouse"], ["route", "Route"], ["status", "Status"],
  ["shippedAtRaw", "Shipped from China"], ["inboundAtRaw", "Into China warehouse"],
  ["paidAtRaw", "Paid at"], ["payMethod", "Payment method"], ["notes", "Notes"],
  ["shelf", "Shelf / location"],
];
const ALIAS = {
  barcode: ["barcode", "bar code", "code", "sku", "tracking", "trackingnumber", "trackingno", "awb",
            "order number", "ordernumber", "order no", "orderno", "package tracking number", "订单号", "包裹单号"],
  name: ["name", "item", "itemname", "description", "desc", "goods", "product", "productname",
         "package item name", "packageitemname", "货品名", "商品名", "货品名英文名"],
  clientId: ["clientid", "client id", "customerid", "customer id", "userid", "客户id"],
  customer: ["customer", "client", "consignee", "receiver", "customername", "buyer",
             "username", "user name", "用户名"],
  phone: ["phone", "mobile", "tel", "telephone", "contact", "mobile phone", "mobilephone", "手机", "电话"],
  parcel: ["parcel", "parcelno", "parcelnumber", "parcelnum", "box", "carton", "shipment",
           "shipmentno", "shipment name", "lot"],
  itemId: ["itemid", "itemno", "ref", "reference", "itemcode"],
  qty: ["quantity", "qty", "package item quantity", "packageitemquantity",
        "total package item count", "货品数量", "商品数量"],
  weightKg: ["weight", "weightkg", "kg", "grossweight", "gw", "实际重量",
             "outbound actual weight kg", "outboundactualweightkg",
             "inbound actual weight kg", "inboundactualweightkg", "package weight kg", "packageweightkg"],
  cbm: ["cbm", "volume", "m3", "cubic", "cubicmeter", "vol", "体积",
        "outbound volume m", "outboundvolumem", "outbound volume",
        "package volume m", "packagevolumem", "package volume"],
  lenCm: ["lengthcm", "length", "长"],
  widCm: ["widthcm", "width", "宽"],
  hgtCm: ["heightcm", "height", "高"],
  sizeLWH: ["package size lwh", "packagesizelwh", "package size", "boxsize", "size", "dimensions", "尺寸", "尺寸cm"],
  cny: ["actual payment amount", "actualpaymentamount", "amountcny", "rmb", "yuan", "实际支付金额"],
  cost: ["cost", "price", "charge", "fee", "freight", "chargeusd", "amountusd"],
  declared: ["total declared value", "totaldeclaredvalue", "declaredvalue", "商品申报价值", "申报价值"],
  origin: ["warehouse", "origin warehouse", "originwarehouse", "发货仓"],
  route: ["route name", "routename", "route", "line", "渠道"],
  status: ["status", "state", "stage"],
  shelf: ["shelf", "location", "loc", "bin", "rack", "position",
          "package location", "packagelocation"],
  paidAtRaw: ["paid at", "paidat", "paidtime", "付款时间"],
  shippedAtRaw: ["shipped at", "shippedat", "shipped", "发货时间", "出库时间"],
  inboundAtRaw: ["package inbound time", "inbound time", "inboundtime", "入库时间"],
  payMethod: ["payment method", "paymentmethod", "payment", "paymentstatus", "paid", "ispaid", "settled"],
  notes: ["notes", "note", "remark", "remarks", "comment", "comments",
          "warehouse remark", "warehouseremark", "备注"],
};
/* Where a sheet has several columns a field could take, the exact header wins. */
const PREFER = {
  barcode: ["ordernumber"], name: ["packageitemname"], customer: ["username"],
  parcel: ["shipment"], qty: ["packageitemquantity"], weightKg: ["outboundactualweightkg"],
  cbm: ["outboundvolumem"], cny: ["actualpaymentamount"],
  origin: ["warehouse"], route: ["routename"], notes: ["warehouseremark"],
};
const hkey = s => String(s || "").toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");

function guessMap(headers) {
  const m = {}, keys = headers.map(hkey), taken = new Set();
  for (const fld in PREFER)
    for (const want of PREFER[fld]) {
      const i = keys.indexOf(hkey(want));
      if (i >= 0 && !taken.has(i)) { m[fld] = i; taken.add(i); break; }
    }
  keys.forEach((k, i) => {
    if (!k || taken.has(i)) return;
    for (const fld in ALIAS) {
      if (m[fld] != null) continue;
      if (ALIAS[fld].some(a => hkey(a) === k)) { m[fld] = i; taken.add(i); return; }
    }
  });
  /* The dashboard's location column is months out of date — it is what the
     shelf reconciliation had to work around. Never map it by default. */
  delete m.shelf;
  return m;
}

/* "2026-10-22 15:00:16" and friends. Anything that is not a real past date is
   treated as no date at all, rather than becoming 1970 or next year. */
function parseStamp(s) {
  const t = String(s || "").trim();
  if (!t || /^0+$/.test(t)) return null;
  const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const when = new Date(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if (isNaN(when) || when.getTime() > Date.now() + 86400000) return null;
  return when.toISOString();
}

const normStatus = s => {
  const k = String(s || "").toLowerCase();
  if (/deliver/.test(k)) return "delivered";
  if (/release|out for|driver/.test(k)) return "released";
  if (/shelf|shelved|stored/.test(k)) return "shelved";
  if (/transit|on the way|expect|pending/.test(k)) return "expected";
  if (/branch|hamra|office|collect/.test(k)) return "at_branch";
  if (/receiv|arriv|warehouse/.test(k)) return "received";
  return "";
};

/* Turn the mapped sheet into the rows the database's importer expects. */
function buildImportRows() {
  const { headers, data, map } = S.imp;
  const fallbackRate = Number(S.cfg && S.cfg.cnyPerUsd) || 0;
  const num = s => {
    const n = parseFloat(String(s).replace(/[^\d.-]/g, ""));
    return isFinite(n) ? n : 0;
  };
  const rows = [];
  let noBarcode = 0;
  const seen = new Set();
  let dupes = 0;

  for (const r of data) {
    const cell = f => (map[f] != null && r[map[f]] != null) ? String(r[map[f]]).trim() : "";
    const barcode = normBc(cell("barcode"));
    if (!barcode) { noBarcode++; continue; }
    if (seen.has(barcode)) dupes++;
    seen.add(barcode);

    const o = { barcode };
    const put = (k, v) => { if (v !== "" && v != null) o[k] = v; };
    put("name", cell("name"));
    put("item_id", cell("itemId"));
    put("client_id", cell("clientId"));
    put("customer", cell("customer"));
    /* some exports lose the country code and leave a leading dash */
    put("phone", cell("phone").replace(/^[-\s]+/, "").trim());
    put("shipment", cell("parcel"));
    put("origin", cell("origin"));
    put("route", cell("route"));
    put("notes", cell("notes"));
    if (cell("qty")) o.qty = Math.round(num(cell("qty")));
    if (cell("weightKg")) o.weight_kg = num(cell("weightKg"));
    if (cell("declared")) o.declared = num(cell("declared"));

    /* Volume: an explicit CBM column if there is one, otherwise worked out
       from the box, which avoids the chargeable column meaning CBM on sea
       routes and kilos on air. */
    let cbm = num(cell("cbm"));
    const L = num(cell("lenCm")), W = num(cell("widCm")), H = num(cell("hgtCm"));
    if (L && W && H) {
      o.dims = L + "×" + W + "×" + H + " cm";
      if (!cbm) cbm = +((L * W * H) / 1e6).toFixed(6);
    } else {
      const parts = cell("sizeLWH").split(/[*x×X,\s]+/).map(num).filter(n => n > 0);
      if (parts.length === 3) {
        o.dims = parts[0] + "×" + parts[1] + "×" + parts[2] + " cm";
        if (!cbm) cbm = +((parts[0] * parts[1] * parts[2]) / 1e6).toFixed(6);
      }
    }
    if (cbm) o.cbm = cbm;

    const shipped = parseStamp(cell("shippedAtRaw"));
    if (shipped) o.shipped_at = shipped;

    /* Charge: yuan at the monthly rate (or fallback), unless a USD column is mapped. */
    const cny = num(cell("cny"));
    const rate = shipped ? rateForMonth(shipped) : fallbackRate;
    if (cny) { o.cny = cny; if (rate > 0) o.cost = +(cny / rate).toFixed(2); }
    if (cell("cost")) o.cost = num(cell("cost"));
    const inbound = parseStamp(cell("inboundAtRaw"));
    if (inbound) o.inbound_at = inbound;

    const paidAt = cell("paidAtRaw"), pm = cell("payMethod");
    if (pm) o.pay_method = pm;
    /* A real paid-at date means settled; "cash on delivery" means not yet. */
    if (map.paidAtRaw != null) o.paid = !!parseStamp(paidAt);
    else if (/cash on delivery|\bcod\b|unpaid|not paid/i.test(pm)) o.paid = false;
    else if (/\bpaid\b|settled|prepaid/i.test(pm)) o.paid = true;

    if (map.status != null) { const st = normStatus(cell("status")); if (st) o.status = st; }
    rows.push(o);
  }

  /* A column can be mapped correctly and still be empty from top to bottom —
     the dashboard lets you tick a column it then exports blank. That looks
     exactly like a successful import until someone goes looking for the
     figure, so it is worth saying out loud. */
  const produced = new Set();
  for (const r of rows) for (const k in r) produced.add(k);
  const SENDS = {
    name: "name", clientId: "client_id", customer: "customer", phone: "phone",
    parcel: "shipment", itemId: "item_id", qty: "qty", weightKg: "weight_kg",
    cbm: "cbm", declared: "declared", cny: "cny", cost: "cost",
    origin: "origin", route: "route", notes: "notes", payMethod: "pay_method",
    shippedAtRaw: "shipped_at", inboundAtRaw: "inbound_at",
  };
  const emptyCols = [];
  for (const f in SENDS)
    if (map[f] != null && !produced.has(SENDS[f]))
      emptyCols.push((IMPORT_FIELDS.find(x => x[0] === f) || [f, f])[1] +
        " (" + (headers[map[f]] || "column " + (map[f] + 1)) + ")");

  /* Point the barcode row at the wrong column and the import will cheerfully
     invent a parcel per distinct value. It happened: thirty-four shelf labels
     became thirty-four empty parcels. A real parcel number is long and mostly
     digits — the same test the scanner uses to tell a parcel from a shelf — so
     anything failing it is worth stopping on. */
  const distinctCodes = new Set(rows.map(r => r.barcode));
  const notParcelNos = [...distinctCodes].filter(b => !looksLikeParcelNo(b));
  /* And a row carrying nothing but a barcode would create a blank record. */
  const bare = rows.filter(r => Object.keys(r).length === 1).length;

  return { rows, noBarcode, dupes, emptyCols, notParcelNos, bare,
           distinct: distinctCodes.size };
}

/* ------------------------------------------------------- a floor scan ----- */
/* The PDA writes `barcode, shelf, scanned at`, and that file is the opposite
   of a dashboard export: it is the only thing that actually knows where a
   parcel is, because somebody stood in front of the shelf and read both
   labels. So it takes a different path — one that does set the shelf, and
   sets the status with it. A parcel the dashboard still calls "on the way" is
   plainly not on the way if it is sitting on C20-01-05. */

const isScanFile = headers => {
  const k = headers.map(hkey);
  return k.includes("barcode") && k.includes("shelf") &&
    (k.includes("scannedat") || k.includes("scanned") || k.includes("time"));
};

/* Every distinct shelf in the file, with what is wrong with it if anything. */
function scanShelves(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = r.shelf;
    if (!by.has(key)) by.set(key, { shelf: key, n: 0, zone: "", why: "" });
    by.get(key).n++;
  }
  for (const s of by.values()) {
    const zm = s.shelf.match(/^ZONE-(.+)$/i);
    if (zm) {
      const code = zm[1].toUpperCase();
      const z = S.zones.find(x => x.code.toUpperCase() === code);
      s.zone = z ? z.code : code;
      s.shelf = code;
      if (!z) s.why = "zone \"" + code + "\" is not set up yet";
      continue;
    }
    const asZone = S.zones.find(z => z.code.toUpperCase() === s.shelf);
    if (asZone) { s.zone = asZone.code; continue; }
    const bad = shelfOutOfRange(s.shelf);
    if (bad) { s.why = bad; continue; }
    s.zone = zoneForShelf(s.shelf);
    if (!s.zone) s.why = "does not start with any zone you have";
  }
  return [...by.values()].sort((a, b) => a.shelf.localeCompare(b.shelf));
}

function buildScanRows() {
  const { headers, data } = S.imp;
  const k = headers.map(hkey);
  const iBc = k.indexOf("barcode");
  const iSh = k.indexOf("shelf");
  const iAt = k.findIndex(x => x === "scannedat" || x === "scanned" || x === "time");
  const rows = [];
  let blank = 0;
  for (const r of data) {
    const barcode = normBc(r[iBc] == null ? "" : String(r[iBc]));
    const shelf = String(r[iSh] == null ? "" : r[iSh]).trim().toUpperCase();
    if (!barcode || !shelf) { blank++; continue; }
    const at = iAt >= 0 ? String(r[iAt] || "").trim() : "";
    const when = at && !isNaN(Date.parse(at)) ? new Date(at).toISOString() : null;
    const zm = shelf.match(/^ZONE-(.+)$/);
    if (zm) {
      rows.push({ barcode, shelf: zm[1], zone: zm[1], at: when });
    } else {
      rows.push({ barcode, shelf, zone: zoneForShelf(shelf) || null, at: when });
    }
  }
  return { rows, blank };
}

function scanSection() {
  const card = el("div", "card pad");
  card.style.marginTop = "18px";
  const hr = el("div", "hr-t");
  hr.append(el("span", "sect-t", "A floor scan"));
  card.append(hr);

  const imp = S.imp;
  const { rows, blank } = buildScanRows();
  const shelves = scanShelves(rows);
  const bad = shelves.filter(s => s.why);
  const badRows = bad.reduce((n, s) => n + s.n, 0);
  const good = rows.length - badRows;

  card.append(banner(null, imp.fileName,
    nf0.format(rows.length) + " scans across " + nf0.format(shelves.length) +
    " shelves" + (blank ? ", " + nf0.format(blank) + " blank rows ignored" : "") + "."));

  card.append(el("div", "sub2",
    "This is your own scan, so it is believed: every parcel here is put on the shelf " +
    "it was scanned on and marked as being on a shelf — including the ones the " +
    "dashboard still thinks are on their way. A parcel scanned twice takes its " +
    "last reading."));

  if (bad.length) {
    const b = banner("warn",
      nf0.format(bad.length) + " shelf label" + (bad.length === 1 ? "" : "s") +
      " did not read — " + nf0.format(badRows) + " parcel" + (badRows === 1 ? "" : "s"),
      "These are skipped. The scan order usually recovers them: a parcel between " +
      "two good labels is on the shelf between them. Fix the physical label too.");
    card.append(b);
    const list = el("div", "list");
    for (const s of bad) {
      const li = el("div", "li");
      const m = el("div", "li-m");
      const nm = el("div", "li-nm");
      nm.append(el("span", "mono", s.shelf));
      nm.append(el("span", "chip off", nf0.format(s.n) + " parcels"));
      m.append(nm);
      m.append(el("div", "li-s", s.why));
      li.append(m);
      list.append(li);
    }
    card.append(list);
  }

  if (S.scanResult) {
    const r = S.scanResult;
    card.append(banner("ok", "Done",
      nf0.format(r.shelved) + " put on their shelves" +
      (r.unchanged ? ", " + nf0.format(r.unchanged) + " already there" : "") +
      (r.unknown_count ? ", " + nf0.format(r.unknown_count) + " not in the system" : "") +
      (r.shipsLocated ? ", " + nf0.format(r.shipsLocated) + " shipping-client shipment" +
        (r.shipsLocated === 1 ? "" : "s") + " filed" : "") + "."));
    if (r.shipsUnknown && r.shipsUnknown.length)
      card.append(banner("warn", "Shipping labels with no shipment",
        r.shipsUnknown.map(n => "SHIP-" + n).join(", ") + " — not in Shipping, so not filed."));
    if (r.unknown_count) {
      card.append(el("div", "sub2",
        "On your shelves but unknown to the warehouse — either the dashboard is " +
        "behind, or it has lost them:"));
      const u = el("div", "mono sub2");
      u.style.cssText = "margin-top:6px;overflow-wrap:anywhere";
      u.textContent = (r.unknown_codes || []).join("  ");
      card.append(u);
      const dl = el("button", "btn sm", "Save that list");
      dl.type = "button";
      dl.onclick = () => offerFile("not-in-system-" + new Date().toISOString().slice(0, 10) + ".csv",
        "barcode\n" + (r.unknown_codes || []).join("\n"));
      const w = el("div", "row");
      w.style.marginTop = "8px";
      w.append(dl);
      card.append(w);
    }

    /* ---------- reconciliation section ---------- */
    if (S.scanRecon && !S.scanReconDone) {
      const rc = S.scanRecon;
      const mc = rc.missing_count || 0;
      const uc = r.unknown_count || 0;
      if (mc || uc) {
        const hr2 = el("div", "hr-t");
        hr2.style.marginTop = "14px";
        hr2.append(el("span", "sect-t", "Reconciliation"));
        card.append(hr2);
        card.append(el("div", "sub2",
          "Only the " + nf0.format(rc.shelves || 0) + " shelves in this file are checked. " +
          "Parcels on other shelves or in other zones are not touched."));

        if (mc) {
          const share = rc.on_shelves ? mc / rc.on_shelves : 0;
          card.append(banner("warn",
            nf0.format(mc) + " of " + nf0.format(rc.on_shelves || mc) + " parcels recorded on these shelves were not found on them",
            "Apply marks them delivered — they left the warehouse." +
            (share > 0.3 ? " That is a lot for one sweep: check the file covers the whole shelf before applying." : "")));
          const mList = el("div", "list");
          mList.style.maxHeight = "200px"; mList.style.overflow = "auto";
          for (const m of (rc.missing || []).slice(0, 200)) {
            const li = el("div", "li");
            const main = el("div", "li-m");
            const nm = el("div", "li-nm");
            nm.append(el("span", "mono", m.barcode), copyBtn(m.barcode));
            if (m.client_id) nm.append(el("span", "chip", m.client_id));
            main.append(nm);
            if (m.customer || m.shelf) main.append(el("div", "li-s",
              [m.customer, m.shelf ? "shelf " + m.shelf : ""].filter(Boolean).join(" · ")));
            li.append(main);
            mList.append(li);
          }
          if (mc > 200) mList.append(el("div", "sub2", "… and " + nf0.format(mc - 200) + " more"));
          card.append(mList);
        }

        if (uc) {
          card.append(banner("",
            nf0.format(uc) + " unknown parcel" + (uc === 1 ? "" : "s") + " will be added to the system",
            "These are on your shelves but not in the database — they will be added as shelved."));
        }

        const reconActs = el("div", "row");
        reconActs.style.marginTop = "10px";
        const applyBtn = el("button", "btn pri",
          S.scanReconRunning ? "Applying…"
            : "Apply reconciliation (" + (mc ? nf0.format(mc) + " delivered" : "") +
              (mc && uc ? ", " : "") + (uc ? nf0.format(uc) + " added" : "") + ")");
        applyBtn.type = "button";
        applyBtn.disabled = !!S.scanReconRunning;
        applyBtn.onclick = () => applyScanRecon();
        reconActs.append(applyBtn);
        const skipBtn = el("button", "btn", "Skip");
        skipBtn.type = "button";
        skipBtn.onclick = () => { S.scanReconDone = true; render(); };
        reconActs.append(skipBtn);
        card.append(reconActs);
      }
    }

    if (S.scanReconDone && S.scanRecon) {
      const rc = S.scanRecon;
      const d = rc.delivered || 0, a = rc.added || 0;
      if (d || a) {
        card.append(banner("ok", "Reconciliation done",
          (d ? nf0.format(d) + " marked delivered" : "") +
          (d && a ? ", " : "") +
          (a ? nf0.format(a) + " added to system" : "") + "."));
      }
    }
  }

  const acts = el("div", "row");
  acts.style.marginTop = "12px";
  const go = el("button", "btn pri", S.scanRunning
    ? "Shelving… " + nf0.format(S.scanDone || 0)
    : "Put " + nf0.format(good) + " parcel" + (good === 1 ? "" : "s") + " on their shelves");
  go.type = "button";
  go.disabled = !good || !!S.scanRunning;
  go.onclick = () => {
    /* Every barcode read counts as seen, even under an unreadable shelf label. */
    S._lastScanRows = rows.filter(r => !isShipLabel(r.barcode))
      .map(r => ({ barcode: r.barcode, shelf: r.shelf, at: r.at }));
    runScanFile(rows.filter(r => !bad.some(b => b.shelf === r.shelf)));
  };
  acts.append(go);
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  cancel.disabled = !!S.scanRunning;
  cancel.onclick = () => { S.imp = null; S.scanResult = null; S.scanRecon = null; S.scanReconDone = false; S._lastScanRows = null; render(); };
  acts.append(cancel);
  card.append(acts);
  return card;
}

const isShipLabel = code => /^SHIP-\d+$/i.test(String(code || ""));

async function runScanFile(allRows) {
  S.scanRunning = true; S.scanDone = 0; S.scanResult = null;
  S.scanRecon = null; S.scanReconDone = false; render();
  /* Shipping-client labels (SHIP-123) are shipments, not parcels: they only get a place. */
  const rows = allRows.filter(r => !isShipLabel(r.barcode));
  const shipRows = allRows.filter(r => isShipLabel(r.barcode));
  let shelved = 0, unchanged = 0, unknown = [], shipsLocated = 0, shipsUnknown = [];
  try {
    if (shipRows.length) {
      const { data, error } = await S.sb.rpc("locate_shipments", {
        p_rows: shipRows.map(r => ({
          ship_num: Number(r.barcode.split("-")[1]),
          zone: r.zone || null,
          shelf: r.shelf && r.shelf !== r.zone ? r.shelf : null,
          at: r.at,
        })) });
      if (error) throw error;
      shipsLocated = Number(data && data.located) || 0;
      shipsUnknown = (data && data.unknown) || [];
      S.ships = null;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { data, error } = await S.sb.rpc("shelve_from_scan", { p_rows: chunk });
      if (error) throw error;
      const r = (data && data[0]) || {};
      shelved += Number(r.shelved) || 0;
      unchanged += Number(r.unchanged) || 0;
      unknown = unknown.concat(r.unknown_codes || []);
      S.scanDone = Math.min(i + chunk.length, rows.length);
      render();
    }
    S.scanResult = { shelved, unchanged, unknown_count: unknown.length, unknown_codes: unknown,
                     unknown_rows: rows.filter(r => unknown.includes(r.barcode)),
                     shipsLocated, shipsUnknown };
    toast(nf0.format(shelved) + " put on their shelves", "ok");
    S.rows = null; S.stats = null; S.zoneStats = null;
    runScanRecon();
  } catch (e) {
    toast("Stopped after " + nf0.format(S.scanDone) + " — " +
      ((e && e.message) || "something went wrong"), "bad");
  }
  S.scanRunning = false;
  render();
}

/* Only parcels recorded on the shelves this file covers are compared — a scan of
   zone A says nothing about zone C. */
async function runScanRecon() {
  try {
    const { data, error } = await S.sb.rpc("reconcile_scan", {
      p_rows: S._lastScanRows || [], p_action: "preview" });
    if (error) throw error;
    S.scanRecon = data;
  } catch (e) {
    S.scanRecon = null;
    toast("Could not compare with the shelves — " + ((e && e.message) || "error"), "bad");
  }
  render();
}

async function applyScanRecon() {
  if (!S.scanResult || !S.scanRecon) return;
  S.scanReconRunning = true; render();
  try {
    const unknownRows = S.scanResult.unknown_rows || [];
    const { data, error } = await S.sb.rpc("reconcile_scan", {
      p_rows: S._lastScanRows || [],
      p_unknown_rows: unknownRows,
      p_action: "apply"
    });
    if (error) throw error;
    S.scanReconDone = true;
    S.scanRecon = data;
    const d = data.delivered || 0, a = data.added || 0;
    const parts = [];
    if (d) parts.push(nf0.format(d) + " marked delivered");
    if (a) parts.push(nf0.format(a) + " added to system");
    toast(parts.join(", ") || "Nothing to change", parts.length ? "ok" : "");
    S.rows = null; S.stats = null; S.zoneStats = null;
  } catch (e) {
    toast((e && e.message) || "Reconciliation failed", "bad");
  }
  S.scanReconRunning = false;
  render();
}

/* ------------------------------------------------------------ the card --- */
function importSection() {
  const card = el("div", "card pad");
  card.style.marginTop = "18px";
  const hr = el("div", "hr-t");
  hr.append(el("span", "sect-t", "Bring a list in"));
  card.append(hr);
  const p = el("div", "sub2");
  p.style.margin = "8px 0 12px";
  p.textContent = "Two kinds of file go here and the app tells them apart. " +
    "A dashboard export (.xlsx or CSV) refreshes what is known about each parcel " +
    "and adds any that are new, without ever moving one off its shelf. " +
    "A floor scan from the PDA — barcode, shelf, scanned at — does the opposite: " +
    "it puts parcels on the shelves they were scanned on.";
  card.append(p);

  if (!isAdmin() && !sees_money()) return card;

  const imp = S.imp;
  /* A scan from the floor is a different thing entirely and gets its own
     screen, rather than being squeezed through the column mapping. */
  if (imp && imp.kind === "scan") return scanSection();
  if (imp && imp.kind === "shipping") return shippingImportSection();
  if (!imp) {
    const row = el("div", "row");
    const pick = el("input");
    pick.type = "file";
    pick.accept = ".csv,.xlsx,.tsv,text/csv";
    pick.className = "inp";
    pick.onchange = () => { if (pick.files && pick.files[0]) readImportFile(pick.files[0]); };
    row.append(pick);
    card.append(row);
    if (S.impBusy) {
      const b = el("div", "sub2");
      b.style.marginTop = "8px";
      b.append(el("span", "spin"));
      b.append(document.createTextNode(" reading the file…"));
      card.append(b);
    }
    if (S.impError) card.append(banner("bad", "Could not read that file", S.impError));
    return card;
  }

  /* --- what came out of the file --- */
  card.append(banner(null, imp.fileName,
    nf0.format(imp.data.length) + " rows, " + imp.headers.length + " columns."));

  /* --- the mapping --- */
  const tbl = el("div", "maplist");
  for (const [fld, label] of IMPORT_FIELDS) {
    const row = el("div", "maprow");
    row.append(el("span", "ml", label));
    const sel = el("select", "inp");
    const none = el("option", null, "— not used —");
    none.value = "";
    sel.append(none);
    imp.headers.forEach((hname, i) => {
      const o = el("option", null, (hname || "(column " + (i + 1) + ")").slice(0, 60));
      o.value = String(i);
      if (imp.map[fld] === i) o.selected = true;
      sel.append(o);
    });
    sel.onchange = () => {
      if (sel.value === "") delete imp.map[fld];
      else imp.map[fld] = +sel.value;
      S.impPreview = null;
      render();
    };
    row.append(sel);
    tbl.append(row);
  }
  card.append(tbl);

  /* The one column that must not be trusted. */
  if (imp.map.shelf != null)
    card.append(banner("warn", "That location column is months out of date",
      "The dashboard's location is where the parcel sat in China, not on your shelves — " +
      "it was the whole reason the floor had to be re-scanned. Importing it will " +
      "overwrite good scan data. Set it back to “not used” unless you are certain."));

  /* --- where new parcels land --- */
  const opts = el("div", "g2");
  opts.style.marginTop = "12px";
  const sw = el("label", "field");
  sw.append(el("span", null, "New parcels arrive as"));
  const ss = el("select", "inp");
  for (const k of ["expected", "received", "shelved", "released", "delivered"]) {
    const o = el("option", null, STATUS[k]);
    o.value = k;
    if (imp.status === k) o.selected = true;
    ss.append(o);
  }
  ss.onchange = () => { imp.status = ss.value; };
  sw.append(ss);
  sw.append(el("div", "sub2", "Only for barcodes not already here. A parcel already " +
    "on a shelf keeps its status and its shelf."));
  opts.append(sw);

  const zw = el("label", "field");
  zw.append(el("span", null, "and land in"));
  const zs = el("select", "inp");
  const zn = el("option", null, "— nowhere in particular —");
  zn.value = "";
  zs.append(zn);
  for (const z of S.zones) {
    const o = el("option", null, z.label || z.code);
    o.value = z.code;
    if (imp.zone === z.code) o.selected = true;
    zs.append(o);
  }
  zs.onchange = () => { imp.zone = zs.value; };
  zw.append(zs);
  opts.append(zw);
  card.append(opts);

  /* --- preview --- */
  const pv = el("div", "row");
  pv.style.marginTop = "12px";
  const check = el("button", "btn sm", S.impChecking ? "Checking…" : "Check against what is here");
  check.type = "button";
  check.disabled = !!S.impChecking || imp.map.barcode == null;
  check.onclick = checkImport;
  pv.append(check);
  card.append(pv);

  if (imp.map.barcode == null)
    card.append(banner("bad", "Pick the barcode column",
      "Nothing can be matched without it."));

  const pr = S.impPreview;
  if (pr) {
    card.append(banner(pr.noBarcode ? "warn" : null,
      nf0.format(pr.newOnes) + " new · " + nf0.format(pr.existing) + " already here",
      (pr.noBarcode ? nf0.format(pr.noBarcode) + " rows have no barcode and will be skipped. " : "") +
      (pr.dupes ? nf0.format(pr.dupes) + " repeated barcodes will collapse into one. " : "") +
      "Nothing has been written yet."));
    if (pr.notParcelNos && pr.notParcelNos.length) {
      const n = pr.notParcelNos.length;
      const most = n > (pr.distinct || pr.total) / 2;
      card.append(banner("bad",
        nf0.format(n) + " of these do not look like parcel numbers",
        "A parcel number is long and mostly digits. These are not — " +
        pr.notParcelNos.slice(0, 8).join(", ") +
        (n > 8 ? " and " + nf0.format(n - 8) + " more" : "") + ". " +
        (most ? "The Barcode row is almost certainly pointed at the wrong column; "
              + "importing this would create a parcel for each of them. "
              : "They will each become a parcel if they are not already here. ") +
        "If this is a floor scan, load it on the Scan tab instead."));
    }
    if (pr.bare)
      card.append(banner("warn", nf0.format(pr.bare) + " rows carry nothing but a barcode",
        "Any of those not already here would be created empty — no name, no " +
        "customer, no charge. A dashboard export always carries more than that."));
    if (pr.emptyCols && pr.emptyCols.length)
      card.append(banner("warn", "Mapped, but blank in every row",
        pr.emptyCols.join(", ") + ". The dashboard will let you tick a column it then " +
        "exports empty. Nothing already here will be blanked — but nothing will be " +
        "filled in either, so tick it properly and export again if you need it."));
  }

  const acts = el("div", "row");
  acts.style.marginTop = "10px";
  /* When most of the "barcodes" are not barcodes, the mapping is wrong and
     going ahead would make a mess that has to be cleaned out of the database
     afterwards. Better to stop than to warn and let it run. */
  const mostlyWrong = pr && pr.notParcelNos &&
    pr.notParcelNos.length > (pr.distinct || pr.total) / 2;
  const go = el("button", "btn pri", S.impRunning
    ? "Bringing them in… " + nf0.format(S.impDone || 0)
    : mostlyWrong ? "Fix the Barcode column first" : "Bring them in");
  go.type = "button";
  go.disabled = imp.map.barcode == null || !!S.impRunning || mostlyWrong;
  go.onclick = runImport;
  acts.append(go);
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  cancel.disabled = !!S.impRunning;
  cancel.onclick = () => {
    S.imp = null; S.impPreview = null; S.impError = ""; render();
  };
  acts.append(cancel);
  card.append(acts);

  if (S.impResult)
    card.append(banner("ok", "Done",
      nf0.format(S.impResult.inserted) + " added, " +
      nf0.format(S.impResult.updated) + " refreshed" +
      (S.impResult.arrived ? ", " + nf0.format(S.impResult.arrived) +
        " moved from on the way to received" : "") + "."));
  return card;
}

/* Several PDA files from one sweep become one scan. */
async function readScanFiles(files) {
  if (files.length === 1) return readImportFile(files[0]);
  S.impBusy = true; S.impError = ""; S.impResult = null; render();
  try {
    const data = [], names = [];
    for (const f of files) {
      const rows = parseCsv(await f.text())
        .filter(r => r && r.some(c => String(c == null ? "" : c).trim() !== ""));
      const headers = (rows[0] || []).map(h => String(h == null ? "" : h).trim());
      if (!isScanFile(headers)) throw new Error(f.name + " is not a floor scan (barcode, shelf, scanned at).");
      const k = headers.map(hkey);
      const iB = k.indexOf("barcode"), iS = k.indexOf("shelf");
      const iA = k.findIndex(x => x === "scannedat" || x === "scanned" || x === "time");
      for (const r of rows.slice(1)) data.push([r[iB], r[iS], iA >= 0 ? r[iA] : ""]);
      names.push(f.name);
    }
    S.imp = { fileName: names.join(", "), headers: ["barcode", "shelf", "scanned at"],
              data, kind: "scan", map: {}, status: "received", zone: "" };
    S.impPreview = null;
    S.scanResult = null; S.scanRecon = null; S.scanReconDone = false; S._lastScanRows = null;
  } catch (e) {
    S.impError = (e && e.message) || String(e);
    S.imp = null;
  }
  S.impBusy = false;
  render();
}

async function readImportFile(file) {
  S.impBusy = true; S.impError = ""; S.impResult = null; render();
  try {
    let rows;
    if (/\.xlsx$/i.test(file.name)) rows = await readXlsx(file);
    else rows = parseCsv(await file.text());
    /* Drop fully blank rows and anything above the header. */
    rows = rows.filter(r => r && r.some(c => String(c == null ? "" : c).trim() !== ""));
    if (rows.length < 2) throw new Error("There is no data under the header row.");
    const headers = rows[0].map(h => String(h == null ? "" : h).trim());
    const scan = isScanFile(headers);
    const shipping = !scan && isShippingFile(headers);
    S.imp = {
      fileName: file.name, headers, data: rows.slice(1),
      kind: scan ? "scan" : shipping ? "shipping" : "export",
      map: (scan || shipping) ? {} : guessMap(headers), status: "received", zone: "",
    };
    S.impPreview = null;
    S.scanResult = null; S.scanRecon = null; S.scanReconDone = false; S._lastScanRows = null;
    if (scan || shipping) { S.impBusy = false; render(); return; }
  } catch (e) {
    S.impError = (e && e.message) || String(e);
    S.imp = null;
  }
  S.impBusy = false;
  render();
  if (S.imp) checkImport();
}

/* Which barcodes are already here. Asked in chunks, because a URL carrying
   three thousand of them would not survive the trip. */
async function checkImport() {
  if (!S.imp || S.imp.map.barcode == null) return;
  S.impChecking = true; render();
  const { rows, noBarcode, dupes, emptyCols, notParcelNos, bare, distinct } = buildImportRows();
  const codes = rows.map(r => r.barcode);
  let existing = 0;
  for (let i = 0; i < codes.length; i += 300) {
    const chunk = codes.slice(i, i + 300);
    const { data, error } = await S.sb.from("parcels_view")
      .select("barcode").in("barcode", chunk);
    if (error) {
      S.impChecking = false;
      toast("Could not check against the warehouse — " + error.message, "bad");
      render();
      return;
    }
    existing += (data || []).length;
  }
  S.impPreview = { total: rows.length, newOnes: rows.length - existing, existing,
                   noBarcode, dupes, emptyCols, notParcelNos, bare, distinct };
  S.impChecking = false;
  render();
}

async function runImport() {
  if (!S.imp || S.imp.map.barcode == null) return;
  const { rows } = buildImportRows();
  if (!rows.length) { toast("No rows with a barcode.", "bad"); return; }

  S.impRunning = true; S.impDone = 0; S.impResult = null; render();
  let inserted = 0, updated = 0, arrived = 0;
  try {
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const { data, error } = await S.sb.rpc("import_parcels", {
        p_rows: chunk,
        p_default_status: S.imp.status,
        p_default_zone: S.imp.zone || null,
      });
      if (error) throw error;
      const r = (data && data[0]) || {};
      inserted += Number(r.inserted) || 0;
      updated += Number(r.updated) || 0;
      /* A received export means they are here: "on the way" ones move to received. */
      if (S.imp.status === "received") {
        const up = await S.sb.rpc("promote_received", { p_barcodes: chunk.map(x => x.barcode) });
        if (up.error) throw up.error;
        arrived += Number(up.data) || 0;
      }
      S.impDone = Math.min(i + chunk.length, rows.length);
      render();
    }
    S.impResult = { inserted, updated, arrived };
    S.imp = null; S.impPreview = null;
    toast(nf0.format(inserted) + " added, " + nf0.format(updated) + " refreshed" +
      (arrived ? ", " + nf0.format(arrived) + " arrived" : ""), "ok");
    S.rows = null; S.stats = null; S.money = null;
    S.customers = null; S.zoneStats = null;
  } catch (e) {
    toast("Stopped after " + nf0.format(S.impDone) + " rows — " +
      ((e && e.message) || "something went wrong"), "bad");
  }
  S.impRunning = false;
  render();
}

/* ----------------------------------------------------------------- staff --- */
function vStaff() {
  const v = el("section");
  const head = el("div", "vhead");
  const h = el("div");
  h.append(el("h2", null, "Staff"));
  h.append(el("div", "sub", "Who can sign in, and what each of them may do."));
  head.append(h);
  const add = el("button", "btn pri", "Add someone");
  add.onclick = askAddStaff;
  add.style.marginLeft = "auto";
  head.append(add);
  headExport(head, () => writeCsv("staff", [
    ["name", "Name"], [r => (ROLES[r.role] || {}).label || r.role, "Role"],
    [r => r.active ? "Yes" : "No", "Can sign in"],
    [r => r.created_at ? String(r.created_at).slice(0, 10) : "", "Added"],
  ], S.staff || []));
  v.append(head);

  v.append(banner(null, "Passwords cannot be read — by anyone",
    "Only a scrambled copy is kept, so nobody (you included) can look one up. Use Reset password to give someone a new one; " +
    "it is shown to you once. Everyone can change their own under Account."));
  v.append(banner(null, "Roles are enforced by the database, not the screen",
    "A scanner who got past this app still cannot read a charge or write one: the records " +
    "view hands them nulls where the money is, and a trigger refuses the write."));

  if (!S.staff.length) {
    const e = el("div", "empty");
    e.append(el("span", "spin"));
    e.append(el("div", null, "Loading staff…"));
    v.append(e);
    return v;
  }

  const list = el("div", "list");
  for (const p of S.staff) list.append(staffRow(p));
  v.append(list);
  return v;
}

function staffRow(p) {
  const li = el("div", "li");
  const m = el("div", "li-m");
  const nm = el("div", "li-nm");
  nm.append(el("span", null, p.name));
  nm.append(roleChip(p.role));
  if (!p.active) nm.append(el("span", "chip off", "Turned off"));
  if (p.id === S.me.id) nm.append(el("span", "me", "— you"));
  m.append(nm);
  const au = (S.staffAuth || {})[p.id] || {};
  const who = el("div", "li-s");
  who.append(el("span", "loc mono", "@" + (p.username || "no username")));
  who.append(document.createTextNode("  " + (au.email || "") +
    "  ·  " + (au.last_sign_in_at ? "last signed in " + fmtDate(au.last_sign_in_at) : (S.staffAuth ? "never signed in" : ""))));
  m.append(who);
  m.append(el("div", "li-s", (ROLES[p.role] || {}).blurb + "  ·  added " + fmtDate(p.created_at)));
  li.append(m);

  const a = el("div", "li-a");
  const pw = el("button", "btn sm", "Reset password");
  pw.onclick = () => askResetPassword(p);
  const un = el("button", "btn sm", "Username");
  un.onclick = () => askStaffField(p, "username");
  const em = el("button", "btn sm", "Email");
  em.onclick = () => askStaffField(p, "email");
  a.append(pw, un, em);
  if (p.id === S.me.id) {
    /* The database only stops the *last* admin stepping down. Stopping it here
       as well is this app's own choice: losing your own way back in is not
       something to do by mis-tapping a dropdown. */
    a.append(el("span", "li-s", "Change your own role from another admin account"));
  } else {
    const sel = el("select", "inp sm");
    sel.style.minHeight = "34px";
    sel.style.width = "auto";
    for (const r in ROLES) {
      const o = el("option", null, ROLES[r].label);
      o.value = r;
      if (p.role === r) o.selected = true;
      sel.append(o);
    }
    sel.onchange = () => setRole(p, sel.value);
    a.append(sel);

    const t = el("button", "btn sm" + (p.active ? " dng" : ""), p.active ? "Turn off" : "Turn on");
    t.onclick = () => setActive(p, !p.active);
    a.append(t);
  }
  li.append(a);
  return li;
}

/* The name alone, which every member of staff may read — unlike the rates
   it sits beside. */
async function loadBrand() {
  const { data, error } = await S.sb.rpc("warehouse_name");
  if (error) return;
  S.brand = (data && data[0]) || null;
  if (S.brand && S.brand.name) document.title = S.brand.name;
  render();
}

async function loadZones() {
  const { data, error } = await S.sb.from("zones")
    .select("code,label,kind,racks,levels,capacity,note,sort").order("sort");
  if (error) { toast("Could not load the zones — " + error.message, "bad"); return; }
  S.zones = data || [];
  /* Receive lands in whichever staging zone the warehouse actually has. */
  if (!S.zones.some(z => z.code === S.recvZone)) {
    const stg = S.zones.find(z => z.kind === "staging");
    if (stg) S.recvZone = stg.code;
  }
  render();
}

async function loadStaff() {
  const { data, error } = await S.sb.from("profiles")
    .select("id,name,role,active,created_at,username")
    .order("role").order("name");
  if (error) { toast(error.message, "bad"); return; }
  S.staff = data || [];
  render();
  /* Emails and last sign-in live with the sign-ins, which only the staff
     function may read. */
  if (isAdmin()) {
    const r = await callFn("staff", { action: "list" });
    if (r.ok) {
      S.staffAuth = Object.fromEntries((r.data.users || []).map(u => [u.id, u]));
      render();
    }
  }
}

async function setRole(p, role) {
  if (role === p.role) return;
  const { error } = await S.sb.from("profiles").update({ role }).eq("id", p.id);
  if (error) { toast(error.message, "bad"); loadStaff(); return; }
  toast(p.name + " is now " + ROLES[role].label.toLowerCase(), "ok");
  loadStaff();
}

async function setActive(p, active) {
  const { error } = await S.sb.from("profiles").update({ active }).eq("id", p.id);
  if (error) { toast(error.message, "bad"); loadStaff(); return; }
  toast(p.name + (active ? " can sign in again" : " can no longer sign in"), "ok");
  loadStaff();
}

/* ------------------------------------------------------------ add staff --- */
function askAddStaff() {
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, "Add someone"));
  const sub = el("p", "sub", "This creates their sign-in and gives them a first password to change.");
  sub.style.margin = "4px 0 16px";
  m.append(sub);

  const err = el("div");
  m.append(err);

  const f1 = el("label", "field");
  f1.append(el("span", null, "Name"));
  const name = el("input", "inp");
  name.required = true; name.placeholder = "Ali Nasser"; name.autocomplete = "off";
  f1.append(name);

  const f2 = el("label", "field");
  f2.append(el("span", null, "Email"));
  const email = el("input", "inp");
  email.type = "email"; email.required = true; email.placeholder = "ali@example.com";
  email.autocomplete = "off";
  f2.append(email);

  const f4 = el("label", "field");
  f4.append(el("span", null, "Username (what they type to sign in)"));
  const uname = el("input", "inp mono");
  uname.placeholder = "ali"; uname.autocomplete = "off"; uname.autocapitalize = "off"; uname.spellcheck = false;
  uname.pattern = "[a-z0-9._-]{3,32}";
  name.addEventListener("input", () => {
    if (!uname.dataset.touched) uname.value = name.value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
  });
  uname.addEventListener("input", () => { uname.dataset.touched = "1"; });
  f4.append(uname);

  const f3 = el("label", "field");
  f3.append(el("span", null, "Role"));
  const role = el("select", "inp");
  for (const r in ROLES) {
    const o = el("option", null, ROLES[r].label + " — " + ROLES[r].blurb);
    o.value = r;
    role.append(o);
  }
  f3.append(role);

  const acts = el("div", "row");
  acts.style.marginTop = "4px";
  const go = el("button", "btn pri", "Create the account");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button";
  no.onclick = () => scrim.remove();
  acts.append(go, no);

  m.append(f1, f4, f2, f3, acts);

  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    err.textContent = "";
    go.disabled = true; no.disabled = true;
    go.textContent = "";
    go.append(el("span", "spin"), document.createTextNode(" Creating"));
    const res = await callFn("staff", {
      action: "create",
      name: name.value.trim(), email: email.value.trim(), role: role.value,
      username: uname.value.trim().toLowerCase(),
    });
    if (!res.ok) {
      err.replaceChildren(banner("bad", "Could not create the account", res.error));
      go.disabled = false; no.disabled = false;
      go.textContent = "Create the account";
      return;
    }
    scrim.remove();
    showFirstPassword(res.data);
    loadStaff();
  });

  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
  name.focus();
}

/* The one time the password is visible. It is not stored anywhere this app can
   read it back, so it is shown once and the admin passes it on. */
function showFirstPassword(d) {
  const scrim = el("div", "scrim");
  const m = el("div", "modal");
  m.append(el("h3", null, d.title || (d.name + " can now sign in")));
  m.append(banner("ok", "Give them these, once",
    "They can change the password themselves under Account. This is the only time it is shown."));
  const box = el("div", "card pad");
  const e = el("div");
  e.append(el("div", "li-s", d.username ? "Username" : "Email"));
  e.append(el("div", "mono", d.username || d.email));
  const p = el("div");
  p.style.marginTop = "10px";
  p.append(el("div", "li-s", d.title ? "New password" : "First password"));
  const pw = el("div", "mono", d.password);
  pw.style.fontSize = "17px";
  pw.style.fontWeight = "600";
  p.append(pw);
  box.append(e, p);
  m.append(box);

  const acts = el("div", "row");
  acts.style.marginTop = "14px";
  const copy = el("button", "btn", "Copy both");
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText((d.username || d.email) + "\n" + d.password);
      toast("Copied", "ok");
    } catch (_) { toast("Could not copy — write them down", "bad"); }
  };
  const done = el("button", "btn pri", "Done");
  done.onclick = () => scrim.remove();
  acts.append(done, copy);
  m.append(acts);
  scrim.append(m);
  document.body.append(scrim);
}

/* An admin cannot read anyone's password — only a hash is kept — but can set
   a new one: made up here, or typed in. It is shown once. */
function askResetPassword(p) {
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, "New password for " + p.name));
  const sub = el("p", "sub", "Their old password stops working straight away. Leave the box empty and the app makes a strong one.");
  sub.style.margin = "4px 0 14px";
  m.append(sub);
  const err = el("div");
  m.append(err);
  const l = el("label", "field");
  l.append(el("span", null, "New password (optional, 8 or more characters)"));
  const i = el("input", "inp mono");
  i.type = "text"; i.autocomplete = "off"; i.autocapitalize = "off"; i.spellcheck = false;
  l.append(i);
  m.append(l);
  const acts = el("div", "row");
  const go = el("button", "btn pri", "Set new password");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button"; no.onclick = () => scrim.remove();
  acts.append(go, no);
  m.append(acts);
  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (i.value && i.value.length < 8) { err.replaceChildren(banner("bad", "Too short", "Use at least 8 characters, or leave it empty.")); return; }
    go.disabled = true; go.textContent = "Setting…";
    const r = await callFn("staff", { action: "reset_password", id: p.id, password: i.value });
    if (!r.ok) {
      go.disabled = false; go.textContent = "Set new password";
      err.replaceChildren(banner("bad", "Could not set it", r.error));
      return;
    }
    scrim.remove();
    showFirstPassword({ title: "New password for " + p.name, name: p.name, username: p.username,
      email: ((S.staffAuth || {})[p.id] || {}).email, password: r.data.password });
  });
  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
  i.focus();
}

/* Change someone's username or email. */
function askStaffField(p, which) {
  const isUser = which === "username";
  const scrim = el("div", "scrim");
  const m = el("form", "modal");
  m.append(el("h3", null, (isUser ? "Username for " : "Email for ") + p.name));
  const sub = el("p", "sub", isUser
    ? "What they type to sign in. Small letters, numbers, dot, dash or underscore."
    : "They can sign in with this as well as their username.");
  sub.style.margin = "4px 0 14px";
  m.append(sub);
  const err = el("div");
  m.append(err);
  const i = el("input", "inp mono");
  i.type = isUser ? "text" : "email"; i.required = true;
  i.autocomplete = "off"; i.autocapitalize = "off"; i.spellcheck = false;
  i.value = isUser ? (p.username || "") : (((S.staffAuth || {})[p.id] || {}).email || "");
  m.append(i);
  const acts = el("div", "row");
  acts.style.marginTop = "14px";
  const go = el("button", "btn pri", "Save");
  go.type = "submit";
  const no = el("button", "btn", "Cancel");
  no.type = "button"; no.onclick = () => scrim.remove();
  acts.append(go, no);
  m.append(acts);
  m.addEventListener("submit", async ev => {
    ev.preventDefault();
    go.disabled = true;
    const v = i.value.trim().toLowerCase();
    const r = await callFn("staff", isUser
      ? { action: "set_username", id: p.id, username: v }
      : { action: "set_email", id: p.id, email: v });
    go.disabled = false;
    if (!r.ok) { err.replaceChildren(banner("bad", "Could not save it", r.error)); return; }
    scrim.remove();
    toast(p.name + "'s " + (isUser ? "username" : "email") + " is now " + v, "ok");
    if (p.id === S.me.id && isUser) S.me.username = v;
    loadStaff();
  });
  scrim.append(m);
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
  i.focus();
}

/* Edge functions want the caller's own token, so an admin check can happen
   server-side where the service key lives. */
async function callFn(fn, body) {
  try {
    const { data, error } = await S.sb.functions.invoke(fn, { body });
    if (error) {
      /* The useful message is in the response body, not the thrown error. */
      let msg = error.message || "That did not work.";
      try {
        const ctx = error.context;
        if (ctx && typeof ctx.json === "function") {
          const j = await ctx.json();
          if (j && j.error) msg = j.error;
        }
      } catch (_) {}
      return { ok: false, error: msg };
    }
    if (data && data.error) return { ok: false, error: data.error };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ------------------------------------------------------------------ boot --- */
function render() {
  const app = $("#app");
  if (!S.session) { app.replaceChildren(vSignIn()); return; }
  if (!S.me) { app.replaceChildren(vNoAccess()); return; }
  const view = S.tab === "staff" && isAdmin() ? vStaff()
             : S.tab === "setup" && sees_money() ? vSetup()
             : S.tab === "shipping" && sees_money() ? vShipping()
             : S.tab === "money" && sees_money() ? vMoney()
             : S.tab === "sales" && canExport() ? vSales()
             : S.tab === "summary" && sees_money() ? vSummary()
             : S.tab === "waseet" && sees_money() ? vWaseet()
             : S.tab === "labels" ? vLabels()
             : S.tab === "stock" ? vStock()
             : S.tab === "zones" ? vZones()
             : vScan();
  app.replaceChildren(shell(view));
  const dr = vDrawer();
  if (dr) app.append(dr);
  afterRender();
}

/* ------------------------------------------------------------ motion fx --- */
/* The screen is rebuilt on every change, so anything that should glide from
   where it was remembers where that was. */
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function afterRender() {
  slideTabPill();
  rollNumbers();
  staggerLists();
}

/* A list whose rows changed (new page, new search, first load) lets them
   arrive one after another. A re-render of the same rows — a tick, a scan —
   leaves them still. */
function staggerLists() {
  const main = document.querySelector("main");
  /* The scan feed changes with every beep; it must not dance. */
  if (!main || S.tab === "scan") return;
  S._lists = S._lists || {};
  main.querySelectorAll(".list").forEach((list, n) => {
    const rows = list.children;
    if (!rows.length) return;
    const key = rows.length + "|" + [...rows].slice(0, 3).map(r => r.textContent.slice(0, 40)).join("|");
    const id = S.tab + "|" + n;
    const changed = S._lists[id] !== key;
    S._lists[id] = key;
    if (!changed || calm()) return;
    [...rows].forEach((r, i) => { r.style.animationDelay = Math.min(i, 24) * 22 + "ms"; });
    list.classList.add("stagger");
  });
}

/* The navy pill slides from the last section to this one. */
function slideTabPill() {
  const nav = document.querySelector(".tabs");
  const cur = nav && nav.querySelector('.tab[aria-current="page"]');
  if (!cur) return;
  nav.classList.add("slide");
  const ind = el("span", "tab-ind");
  nav.prepend(ind);
  const to = { l: cur.offsetLeft, t: cur.offsetTop, w: cur.offsetWidth, h: cur.offsetHeight };
  const from = S._pill || to;
  const place = p => {
    ind.style.left = p.l + "px"; ind.style.width = p.w + "px";
    ind.style.top = to.t + "px"; ind.style.height = to.h + "px";
  };
  ind.style.transition = "none";
  place(calm() ? to : from);
  void ind.offsetWidth;
  ind.style.transition = "";
  place(to);
  S._pill = to;
  /* On a phone the row scrolls: keep the current section in view. */
  if (cur.offsetLeft < nav.scrollLeft || cur.offsetLeft + cur.offsetWidth > nav.scrollLeft + nav.clientWidth)
    nav.scrollLeft = cur.offsetLeft - nav.clientWidth / 2 + cur.offsetWidth / 2;
}

/* Big numbers count up to their value when they first appear or change. */
const NUM_RE = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/;
function rollNumbers() {
  const main = document.querySelector("main");
  if (!main) return;
  S._nums = S._nums || {};
  const entering = main.classList.contains("enter");
  main.querySelectorAll(".tile .v, .zv").forEach((v, i) => {
    const txt = v.textContent.trim();
    if (txt === "…") { v.classList.add("wait"); return; }
    const m = NUM_RE.exec(txt);
    if (!m) return;
    const label = (v.parentElement.querySelector(".k, .zn") || {}).textContent || "";
    const key = S.tab + "|" + i + "|" + label;
    const target = parseFloat(m[2].replace(/,/g, ""));
    const prev = S._nums[key];
    S._nums[key] = target;
    if (calm() || !isFinite(target)) return;
    /* Counts that land within a few seconds of opening the section roll up from 0. */
    const fresh = entering || Date.now() - (S._enterAt || 0) < 4000;
    const start = prev != null ? prev : (fresh ? 0 : null);
    if (start == null || start === target) return;
    const dec = (m[2].split(".")[1] || "").length;
    const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const t0 = performance.now(), D = 750;
    const step = now => {
      if (!v.isConnected) return;
      const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
      v.textContent = m[1] + fmt.format(start + (target - start) * e) + m[3];
      if (p < 1) requestAnimationFrame(step);
    };
    v.textContent = m[1] + fmt.format(start) + m[3];
    requestAnimationFrame(step);
  });
}

/* Press ripple on buttons, scan modes and zone cards. */
document.addEventListener("pointerdown", e => {
  const b = e.target.closest && e.target.closest(".btn, .mode, .zcard");
  if (!b || b.disabled || calm()) return;
  const r = b.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement("span");
  s.className = "rip";
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  b.append(s);
  setTimeout(() => s.remove(), 650);
}, { passive: true });

/* A signed-in account with no profile row, or an inactive one, reads back
   nothing — which is the right answer either way, and the same one. */
async function loadMe() {
  const uid = S.session?.user?.id;
  if (!uid) { S.me = null; return; }
  const { data, error } = await S.sb.from("profiles")
    .select("id,name,role,active,username").eq("id", uid).maybeSingle();
  if (error) { S.me = null; return; }
  S.me = (data && data.active) ? data : null;
}

async function boot() {
  S.sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  loadBuiltAt();
  const { data } = await S.sb.auth.getSession();
  S.session = data.session || null;
  if (S.session) await loadMe();
  if (isCallCenter()) S.tab = "stock";
  render();
  if (S.me) {
    loadBrand(); loadZones();
    if (isCallCenter()) loadCallCenterStock(); else loadStats();
  }
  if (isAdmin()) loadStaff();

  /* The handler must not call the database while the auth library is still
     inside its own callback: signing in by username (setSession) holds a lock
     there, and a query that waits for it never returns. So step out first. */
  S.sb.auth.onAuthStateChange((evt, session) => { setTimeout(() => onAuth(evt, session), 0); });
}

async function onAuth(evt, session) {
  {
    const was = S.session?.user?.id || null;
    S.session = session || null;
    if ((S.session?.user?.id || null) !== was) {
      S.me = null; S.staff = []; S.rows = null;
      S.zones = []; S.scanFeed = []; S.scanTally = null; S.undo = null; S.dest = { zone: "", shelf: "" };
      S.stats = null; S.zoneStats = null; S.page = 0; S.q = "";
      S.filters = { status: "", zone: "", paid: "" };
      S.money = null; S.cfg = null; S.customers = null;
      S.custSearch = ""; S.custPage = 0; S.custTotal = 0;
      S.cfgDraft = null; S.laneCover = null;
      S.brand = null;
      S.ships = null; S.shipStats = null; S.shipQ = "";
      S.shipFilters = { mode: "", paid: "" }; S.shipSel = new Set();
      S.ccData = null; S.ccOpen = new Set(); S.ccQ = "";
      S.bulk = null; S.soData = null; S.soQ = ""; S.soStatus = ""; S.soPay = ""; S.soMonth = ""; S.soPage = 0;
      if (S.session) await loadMe();
      if (isCallCenter()) S.tab = "stock";
      render();
      if (S.me) {
        loadBrand(); loadZones();
        if (isCallCenter()) loadCallCenterStock(); else loadStats();
      }
      if (isAdmin()) loadStaff();
    }
  }
}

boot().catch(e => {
  $("#app").replaceChildren(banner("bad", "The app could not start", String(e && e.message || e)));
});

/* Keeping the app up to date.
 *
 * A page left open all day never reloads, and GitHub Pages lets a browser hold
 * index.html for ten minutes, so a published fix can sit there unseen. The
 * worker is asked to check on every start and whenever the app is brought back
 * to the front; when a new one takes over, the page says so and offers to
 * reload rather than changing under someone mid-scan. */
if ("serviceWorker" in navigator) {
  addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      reg.update().catch(() => {});
      addEventListener("visibilitychange", () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    } catch (_) {}
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    const t = el("div", "toast ok");
    t.append(document.createTextNode("A new version is ready "));
    const b = el("button", "btn sm", "Reload");
    b.style.marginLeft = "8px";
    b.onclick = () => location.reload();
    t.append(b);
    const box = $("#toasts");
    if (box) box.append(t);
    else location.reload();
  });
}
