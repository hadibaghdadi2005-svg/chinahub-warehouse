#!/usr/bin/env node
/* Draw the app icons. No image library — a PNG is a deflated bitmap in four
 * chunks, and the mark is rectangles, so writing the bytes is less work than
 * taking on a dependency.
 *
 *   node app/make-icons.js
 *
 * Writes icon-192.png, icon-512.png and icon-maskable-512.png next to the app.
 * The maskable one keeps the mark inside the middle 60%, which is the safe
 * circle Android may crop to.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const TEAL = [0x0b, 0x5c, 0x5e];
const WHITE = [0xff, 0xff, 0xff];
const OUT = __dirname;

/* ---------------------------------------------------------------- canvas --- */
function canvas(size) {
  const px = Buffer.alloc(size * size * 4);               /* transparent */
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (a === 255) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; return; }
    /* over the existing pixel, so edges can be softened */
    const sa = a / 255, da = px[i + 3] / 255, oa = sa + da * (1 - sa);
    if (oa === 0) return;
    px[i]     = Math.round((r * sa + px[i]     * da * (1 - sa)) / oa);
    px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
    px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
    px[i + 3] = Math.round(oa * 255);
  };
  return { size, px, put };
}

/* A rounded rectangle, sampled 3×3 per pixel so the corners are not jagged. */
function roundRect(c, x0, y0, w, h, r, colour) {
  const inside = (px, py) => {
    if (px < x0 || py < y0 || px > x0 + w || py > y0 + h) return false;
    const cx = Math.min(Math.max(px, x0 + r), x0 + w - r);
    const cy = Math.min(Math.max(py, y0 + r), y0 + h - r);
    const dx = px - cx, dy = py - cy;
    return dx * dx + dy * dy <= r * r || (px >= x0 + r && px <= x0 + w - r) ||
           (py >= y0 + r && py <= y0 + h - r);
  };
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      let hit = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++)
          if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hit++;
      if (hit) c.put(x, y, colour, Math.round((hit / 9) * 255));
    }
}

const rect = (c, x, y, w, h, colour) => roundRect(c, x, y, w, h, 0, colour);

/* ------------------------------------------------------------------ mark --- */
/* A parcel seen head on: an outlined box with a tape seam down the middle and
 * a band across it — reads at 48px, which is where icons actually live. */
function parcel(c, cx, cy, s) {
  const t = Math.max(2, Math.round(s * 0.085));           /* stroke */
  const x0 = cx - s / 2, y0 = cy - s / 2;
  /* box outline */
  rect(c, x0, y0, s, t, WHITE);
  rect(c, x0, y0 + s - t, s, t, WHITE);
  rect(c, x0, y0, t, s, WHITE);
  rect(c, x0 + s - t, y0, t, s, WHITE);
  /* band across, a third of the way down */
  rect(c, x0, y0 + Math.round(s * 0.36), s, t, WHITE);
  /* tape seam, upper half only, so it looks like a flap */
  rect(c, cx - t / 2, y0, t, Math.round(s * 0.36), WHITE);
}

/* ------------------------------------------------------------------- png --- */
function png(c) {
  const { size, px } = c;
  /* each row is prefixed with its filter byte; 0 means "no filter" */
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      /* 8 bits per channel */
  ihdr[9] = 6;      /* truecolour with alpha */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ draw --- */
function icon(size, maskable) {
  const c = canvas(size);
  if (maskable) {
    rect(c, 0, 0, size, size, TEAL);                      /* bleeds to the edge */
    parcel(c, size / 2, size / 2, Math.round(size * 0.42));
  } else {
    roundRect(c, 0, 0, size, size, Math.round(size * 0.22), TEAL);
    parcel(c, size / 2, size / 2, Math.round(size * 0.52));
  }
  return png(c);
}

for (const [file, size, mask] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
]) {
  const buf = icon(size, mask);
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log(file.padEnd(24) + size + "×" + size + "  " + (buf.length / 1024).toFixed(1) + " KB");
}
