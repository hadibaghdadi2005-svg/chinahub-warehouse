#!/usr/bin/env node
/* Check the scan station's barcode logic against the real warehouse layout.
 *
 *   node app/test-scan-logic.js
 *
 * The functions are lifted straight out of the published page and run here, so
 * what is tested is what ships — not a copy that can drift away from it.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

/* Pull out just the pure functions; everything else needs a browser. */
const wanted = ["normBc", "looksLikeParcelNo", "zoneForShelf", "shelfOutOfRange"];
const src = wanted.map(name => {
  const re = new RegExp("(?:^|\\n)(?:const " + name + " = [\\s\\S]*?;|function " + name +
    "\\([\\s\\S]*?\\n\\})", "m");
  const m = mod.match(re);
  if (!m) throw new Error("could not find " + name + " in the page");
  return m[0];
}).join("\n");

/* The zones as they actually are in the database. */
const S = {
  zones: [
    { code: "A", label: "Zone A", kind: "shelf", racks: 10, levels: 5 },
    { code: "B", label: "Zone B", kind: "shelf", racks: 24, levels: 5 },
    { code: "C", label: "Zone C", kind: "shelf", racks: 22, levels: 5 },
    { code: "D", label: "Zone D", kind: "shelf", racks: 8, levels: 5 },
    { code: "RCV", label: "Receiving", kind: "staging" },
    { code: "SHIP", label: "Shipping department", kind: "staging" },
    { code: "OUT", label: "Outbound", kind: "staging" },
  ],
};
const ctx = vm.createContext({ S, console });
vm.runInContext(src, ctx);
/* `function` declarations land on the context's global, but `const` ones only
   create a lexical binding — so each name is read back by evaluating it. */
const [normBc, looksLikeParcelNo, zoneForShelf, shelfOutOfRange] =
  wanted.map(n => vm.runInContext(n, ctx));

let pass = 0, fail = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log("  FAIL  " + what + "\n        got  " + JSON.stringify(got) +
    "\n        want " + JSON.stringify(want));
};

console.log("a real barcode is not mistaken for a shelf label");
for (const bc of ["YT7600000000001", "110000000000001", "ZY20000000000000000001",
                  "SF5100000000001", "100000000001", "DPK300000000001"])
  check(bc, looksLikeParcelNo(bc), true);

console.log("a shelf label is not mistaken for a parcel");
for (const sh of ["A1-01-01", "B24-01-05", "C18-01-01", "D8-01-05", "A10-01-03"])
  check(sh, looksLikeParcelNo(sh), false);

console.log("the zone is read off the front of the shelf code");
check("A1-01-01",  zoneForShelf("A1-01-01"),  "A");
check("B24-01-05", zoneForShelf("B24-01-05"), "B");
check("C18-01-01", zoneForShelf("C18-01-01"), "C");
check("D8-01-05",  zoneForShelf("D8-01-05"),  "D");
check("lowercase", zoneForShelf("c3-01-02"),  "C");
check("unknown zone letter", zoneForShelf("Z9-01-01"), "");

console.log("a misread pointing off the end of a zone is caught");
check("B25 when B has 24 racks", /racks 1–24/.test(shelfOutOfRange("B25-01-01")), true);
check("A11 when A has 10 racks", /racks 1–10/.test(shelfOutOfRange("A11-01-01")), true);
check("D9 when D has 8 racks",   /racks 1–8/.test(shelfOutOfRange("D9-01-01")),   true);
check("level 6 when there are 5", /levels 1–5/.test(shelfOutOfRange("A1-01-06")),  true);
check("rack 0 is not a rack",     /racks/.test(shelfOutOfRange("A0-01-01")),       true);

console.log("shelves that do exist are left alone");
for (const sh of ["A1-01-01", "A10-01-05", "B24-01-05", "C22-01-05", "D8-01-05"])
  check(sh, shelfOutOfRange(sh), "");

console.log("a code in another shape is accepted as given");
check("free-form label", shelfOutOfRange("RACK-7"), "");
check("staging zone",    shelfOutOfRange("SHIP"),   "");

console.log("whitespace around a scan is trimmed");
check("trailing newline", normBc("  YT7600000000001 \n "), "YT7600000000001");
check("inner run of spaces", normBc("A1   01"), "A1 01");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
