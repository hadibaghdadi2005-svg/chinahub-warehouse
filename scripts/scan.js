/* Shared pieces for working with a floor scan: reading the PDA scanner's CSV,
 * checking shelf labels against the real rack layout, and deriving the document
 * id the warehouse app stores a parcel under.
 */

const fs = require("fs");
const path = require("path");

/* --------------------------- the rack layout ---------------------------
 * Four zones, five levels each, level 01 at the top. Rack counts differ.
 */
const ZONES = { A: 10, B: 24, C: 22, D: 8 };
const LEVELS = 5;

/* Two label conventions are in use on the physical shelves, and both are live:
 *
 *   ZONE+RACK-01-LEVEL   A1-01-03, B17-01-04, C10-01-02, D01-01-05
 *   ZONE-RACK-LEVEL      C-01-03, D-07-04        (zone C racks 1-9, zone D racks 7-8)
 *
 * The middle segment of the first form is always 01. Both are unambiguous
 * because the first segment either carries digits or it does not.
 */
function parseShelf(code) {
  const s = String(code || "").trim().toUpperCase();
  let m = s.match(/^([A-Z])(\d+)-(\d+)-(\d+)$/);
  if (m) return { zone: m[1], rack: +m[2], level: +m[4], form: "zone+rack" };
  m = s.match(/^([A-Z])-(\d+)-(\d+)$/);
  if (m) return { zone: m[1], rack: +m[2], level: +m[3], form: "zone-rack" };
  return null;
}

/** "" when the label is good, otherwise why it is not. */
function shelfProblem(code) {
  const p = parseShelf(code);
  if (!p) return "unreadable label";
  const racks = ZONES[p.zone];
  if (!racks) return "zone " + p.zone + " is not one of " + Object.keys(ZONES).join("/");
  if (p.rack < 1 || p.rack > racks)
    return "zone " + p.zone + " has racks 1-" + racks + ", not " + p.rack;
  if (p.level < 1 || p.level > LEVELS)
    return "level " + p.level + " is outside 1-" + LEVELS;
  return "";
}

/* The dashboard's parcel numbers are long and mostly digits; a shelf label is
 * short and starts with its zone letter. The PDA scanner uses the same test to
 * decide whether a scan is a parcel or a new shelf. */
function looksLikeParcel(code) {
  const s = String(code || "");
  if (s.length < 11) return false;
  return s.replace(/\D/g, "").length / s.length > 0.7;
}

/* ----------------------------- document ids -----------------------------
 * Mirrors the app exactly. Change one and you must change the other, or a
 * bundle will not line up with the records already stored.
 */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function docId(barcode) {
  const raw = String(barcode || "").trim();
  const safe = raw.replace(/[^A-Za-z0-9_.~:@+-]/g, "_").slice(0, 180);
  if (!safe || safe === "." || safe === "..") return "bc_" + hash(raw);
  return safe === raw ? safe : safe + "-" + hash(raw);
}

/* ------------------------------ scan files ------------------------------
 * The PDA scanner exports "barcode,shelf,scanned at". Pass a directory and
 * every scan file in it is read, which is how one file per zone works.
 *
 * A directory is filtered on the header line, because the reports these
 * scripts write are also .csv and sit in the same folders; a file named
 * explicitly is read whatever its header says.
 */
/* The scanner's header is exactly "barcode,shelf,scanned at", and nothing
 * looser will do: the reports these scripts write also lead with barcode, also
 * carry a shelf column, and some carry a timestamp too. Match the three field
 * names in order and scanner output is the only thing that qualifies. */
const SCAN_HEADER = ["barcode", "shelf", "scanned at"];
const isScanHeader = line => {
  const f = String(line || "").split(",").map(s => s.trim().replace(/^"|"$/g, "").toLowerCase());
  return SCAN_HEADER.every((want, i) => f[i] === want);
};

function readScans(target) {
  let files;
  if (fs.statSync(target).isDirectory()) {
    files = fs.readdirSync(target)
      .filter(f => /\.csv$/i.test(f))
      .map(f => path.join(target, f))
      .filter(f => {
        const first = fs.readFileSync(f, "utf8").split(/\r?\n/)[0] || "";
        return isScanHeader(first);
      });
    if (!files.length) throw new Error("no scan files in " + target +
      " (a scan file's header line names a barcode and a shelf column)");
  } else {
    files = [target];
  }

  const rows = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) continue;
    if (/barcode/i.test(lines[0])) lines.shift();
    lines.forEach((line, i) => {
      const p = line.split(",");
      rows.push({
        file: path.basename(file),
        line: i + 2,
        barcode: (p[0] || "").trim(),
        shelf: (p[1] || "").trim(),
        at: (p[2] || "").trim(),
      });
    });
  }
  return rows;
}

/* A label typo worth fixing silently: the middle segment is always 01, so
 * "C10-0-2" means "C10-01-02". Returns the corrected code and a note. */
function tidyShelf(code) {
  const m = String(code || "").trim().match(/^([A-Z]\d+)-(\d+)-(\d+)$/i);
  if (m && m[2] !== "01") {
    const fixed = m[1].toUpperCase() + "-01-" + m[3].padStart(2, "0");
    return { shelf: fixed, note: "middle segment corrected from " + code };
  }
  return { shelf: String(code || "").trim(), note: "" };
}

/* CSV field quoting */
const q = v => {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (header, rows) =>
  header.join(",") + "\n" + rows.map(r => r.map(q).join(",")).join("\n") + "\n";

module.exports = {
  ZONES, LEVELS,
  parseShelf, shelfProblem, looksLikeParcel,
  docId, hash,
  readScans, tidyShelf,
  toCsv,
};
