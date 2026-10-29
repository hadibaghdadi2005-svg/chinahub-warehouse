/* Minimal reader for the .xlsx files the ChinaHub dashboard exports.
 *
 * No dependencies: a worksheet is just XML inside a ZIP, and Node already has
 * the inflate half of zlib. Written against the real exports, which means it
 * handles the two things that catch a naive parser out:
 *
 *   - strings live in sharedStrings.xml, not in the cell, and one <si> entry
 *     may be split across several <t> runs
 *   - a row skips empty cells entirely, so position must come from each cell's
 *     own r="B12" reference rather than from counting
 *
 * Usage:
 *   const { readSheet, sheetNames } = require("./xlsx");
 *   const rows = readSheet("EXPORT.xlsx", 1);   // array of arrays, row 0 = headers
 */

const fs = require("fs");
const zlib = require("zlib");

/* ----------------------------- the ZIP part ----------------------------- */

function unzip(file) {
  const buf = fs.readFileSync(file);

  // the end-of-central-directory record sits at the back, after a comment of
  // unknown length, so scan backwards for its signature
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file: " + file);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commLen  = buf.readUInt16LE(p + 32);
    const localAt  = buf.readUInt32LE(p + 42);
    const name     = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // the local header repeats the name and carries its own extra field,
    // whose length can differ from the central directory's
    const lNameLen  = buf.readUInt16LE(localAt + 26);
    const lExtraLen = buf.readUInt16LE(localAt + 28);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

/* ----------------------------- the XML part ----------------------------- */

const decode = s => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, "&");          // last, or real ampersands double-decode

/* "B12" -> 1. Column letters are base-26 with A = 1. */
function columnIndex(ref) {
  const letters = ref.match(/^([A-Z]+)/)[1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(zip) {
  const f = zip.get("xl/sharedStrings.xml");
  if (!f) return [];
  const xml = f.toString("utf8");
  const out = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    let s = "";
    for (const t of (m[1] || "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += t[1];
    out.push(decode(s));
  }
  return out;
}

function parseSheet(xml, strings) {
  const rows = [];
  for (const rm of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || "";
      const ref  = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || "n";
      let v = "";
      if (type === "inlineStr") {
        for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) v += t[1];
        v = decode(v);
      } else {
        const vm = body.match(/<v>([\s\S]*?)<\/v>/);
        const raw = vm ? vm[1] : "";
        v = type === "s" ? (strings[+raw] ?? "") : decode(raw);
      }
      if (ref) row[columnIndex(ref)] = v; else row.push(v);
    }
    rows.push(row);
  }
  return rows;
}

/* ------------------------------- the API ------------------------------- */

function sheetNames(file) {
  const xml = unzip(file).get("xl/workbook.xml").toString("utf8");
  return [...xml.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map(m => decode(m[1]));
}

/** `which` is a 1-based sheet number. Row 0 holds the headers. */
function readSheet(file, which = 1) {
  const zip = unzip(file);
  const f = zip.get("xl/worksheets/sheet" + which + ".xml");
  if (!f) throw new Error("no sheet " + which + " in " + file);
  return parseSheet(f.toString("utf8"), sharedStrings(zip));
}

/** Rows as objects keyed by their header, with empty cells as "". */
function readRecords(file, which = 1) {
  const rows = readSheet(file, which);
  const head = (rows[0] || []).map(h => String(h ?? "").trim());
  return rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = r[i] == null ? "" : String(r[i]).trim(); });
    return o;
  });
}

module.exports = { readSheet, readRecords, sheetNames, unzip };
