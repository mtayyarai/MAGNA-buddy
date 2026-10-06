'use strict';

// Generates:
//   build/icon.ico      -> installer + Windows exe icon
//   build/icon.png      -> 256x256, general app icon
//   src/tray.png        -> 32x32, loaded by main.js inside the asar
//
// Pure Node — no image library required. PNG writer + CRC32 implemented inline.

const { deflateSync } = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const ROOT  = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const SRC   = path.join(ROOT, 'src');
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(SRC,   { recursive: true });

// --- CRC32 (standard PNG polynomial) ---------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF >>> 0;
  for (let i = 0; i < buf.length; i++) crc = (CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// --- PNG writer (RGBA 8-bit, no interlace) ---------------------------------
function makePNG(w, h, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8]  = 8;   // bit depth
  ihdr[9]  = 6;   // color type RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;                    // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const off = y * stride + 1 + x * 4;
      raw[off]     = r & 0xFF;
      raw[off + 1] = g & 0xFF;
      raw[off + 2] = b & 0xFF;
      raw[off + 3] = a & 0xFF;
    }
  }
  const compressed = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Magna "googly" character pixel renderer ------------------------------
// Body: Magna red radial (#dc3232 → #4e0f0a). Eyes: white with black pupil.
// Small white Magna "M" badge with a green #32b446 dot in the bottom-left.
function googlyPixel(W, H) {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const bodyR = Math.min(W, H) / 2 - 1;

  // Two googly eyes, both visible (top-left and top-right-ish).
  const eyeLx = cx - W * 0.17;
  const eyeRx = cx + W * 0.17;
  const eyeY  = cy - H * 0.08;
  const eyeR  = W * 0.18;
  const pupOff = W * 0.04;
  const pupR  = W * 0.075;

  // Magna "M" badge bottom-left
  const badgeCx = cx - W * 0.26;
  const badgeCy = cy + H * 0.26;
  const badgeR  = W * 0.18;
  const dotCx   = badgeCx + W * 0.08;
  const dotCy   = badgeCy + H * 0.08;
  const dotR    = W * 0.055;

  // Highlight on body (shine)
  const shineCx = cx - W * 0.18;
  const shineCy = cy - H * 0.22;
  const shineR  = W * 0.1;

  // Red radial: linear interpolation from inner to outer colour depending on
  // distance from the gradient origin (approximates CSS radial-gradient).
  const gcx = cx - W * 0.18;
  const gcy = cy - H * 0.22;
  const innerR  = [255, 122, 122];
  const midR    = [220,  50,  50];
  const outerR  = [ 78,  15,  10];

  function bodyColour(px, py) {
    const d = Math.hypot(px - gcx, py - gcy);
    const t = Math.min(1, d / (bodyR * 0.9));
    let c0, c1, u;
    if (t < 0.5) { c0 = innerR; c1 = midR;   u = t * 2; }
    else         { c0 = midR;   c1 = outerR; u = (t - 0.5) * 2; }
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * u),
      Math.round(c0[1] + (c1[1] - c0[1]) * u),
      Math.round(c0[2] + (c1[2] - c0[2]) * u)
    ];
  }

  return (x, y) => {
    // 2x2 supersample AA
    let R = 0, G = 0, B = 0, A = 0;
    const samples = [
      [x + 0.25, y + 0.25], [x + 0.75, y + 0.25],
      [x + 0.25, y + 0.75], [x + 0.75, y + 0.75]
    ];
    for (const [sx, sy] of samples) {
      const bd = Math.hypot(sx - cx, sy - cy);
      if (bd > bodyR + 0.5) continue;

      // Badge dot (Magna green)
      if (Math.hypot(sx - dotCx, sy - dotCy) <= dotR) {
        R += 50; G += 180; B += 70; A += 255; continue;
      }
      // Badge (white circle)
      if (Math.hypot(sx - badgeCx, sy - badgeCy) <= badgeR) {
        R += 255; G += 255; B += 255; A += 255; continue;
      }
      // Pupils
      if (Math.hypot(sx - (eyeLx + pupOff), sy - (eyeY + pupOff)) <= pupR
       || Math.hypot(sx - (eyeRx + pupOff), sy - (eyeY + pupOff)) <= pupR) {
        R += 25; G += 20; B += 25; A += 255; continue;
      }
      // Eye whites
      if (Math.hypot(sx - eyeLx, sy - eyeY) <= eyeR
       || Math.hypot(sx - eyeRx, sy - eyeY) <= eyeR) {
        R += 255; G += 255; B += 255; A += 255; continue;
      }
      // Shine highlight
      if (Math.hypot(sx - shineCx, sy - shineCy) <= shineR) {
        R += 255; G += 190; B += 190; A += 255; continue;
      }
      // Body (red radial)
      const bc = bodyColour(sx, sy);
      R += bc[0]; G += bc[1]; B += bc[2]; A += 255;
    }
    return [Math.round(R / 4), Math.round(G / 4), Math.round(B / 4), Math.round(A / 4)];
  };
}

// --- ICO writer (PNG-in-ICO, Vista+) ---------------------------------------
function makeICO(sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);           // reserved
  header.writeUInt16LE(1, 2);           // type = icon
  header.writeUInt16LE(sizes.length, 4);

  const entries = Buffer.alloc(16 * sizes.length);
  const images = [];
  let offset = 6 + 16 * sizes.length;

  sizes.forEach((s, i) => {
    const png = makePNG(s, s, googlyPixel(s, s));
    const e = 16 * i;
    entries[e]     = s === 256 ? 0 : s;         // width  (0 = 256)
    entries[e + 1] = s === 256 ? 0 : s;         // height (0 = 256)
    entries[e + 2] = 0;                          // color palette
    entries[e + 3] = 0;                          // reserved
    entries.writeUInt16LE(1,  e + 4);           // planes
    entries.writeUInt16LE(32, e + 6);           // bit count
    entries.writeUInt32LE(png.length, e + 8);   // image size
    entries.writeUInt32LE(offset,     e + 12);  // offset in file
    offset += png.length;
    images.push(png);
  });

  return Buffer.concat([header, entries, ...images]);
}

// --- Emit files ------------------------------------------------------------
function writeFile(p, buf) {
  fs.writeFileSync(p, buf);
  console.log(`wrote ${path.relative(ROOT, p)} (${buf.length} bytes)`);
}

writeFile(path.join(SRC,   'tray.png'), makePNG(32, 32, googlyPixel(32, 32)));
writeFile(path.join(BUILD, 'icon.png'), makePNG(256, 256, googlyPixel(256, 256)));
writeFile(path.join(BUILD, 'icon.ico'), makeICO([16, 24, 32, 48, 64, 128, 256]));
console.log('done.');
