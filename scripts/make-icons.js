'use strict';

// Generates app icons from the MAGNA brand asset:
//
//   src/tray.png        -> 32×32, loaded by main.js at runtime for the tray
//   build/icon.png      -> 256×256, used by electron-builder (Linux/Mac default)
//   build/icon.ico      -> multi-size ICO (16/24/32/48/64/128/256) for Windows
//                         exe + installer + uninstaller
//
// Source: `src/renderer/magna-logo.svg` (which is actually an SVG wrapper
// around a base64-encoded PNG). We parse the PNG out, trim its transparent
// margin, then resample with jimp to each icon size. ICO is a hand-rolled
// PNG-in-ICO (works on Vista+).

const fs = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { Jimp } = require('jimp');

const ROOT      = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const SRC_DIR   = path.join(ROOT, 'src');
const RENDERER  = path.join(SRC_DIR, 'renderer');
const SVG_PATH  = path.join(RENDERER, 'magna-logo.svg');
// Preferred override: a hand-provided PNG dropped into build/icon-source.png.
// If present, we use it as the icon source and skip the SVG extraction path.
const USER_PNG_PATH = path.join(BUILD_DIR, 'icon-source.png');

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.mkdirSync(SRC_DIR,   { recursive: true });

// ---------------------------------------------------------------------------
// 1. Pick the icon source: user-provided PNG > embedded PNG inside SVG.
// ---------------------------------------------------------------------------
let sourcePNG;
if (fs.existsSync(USER_PNG_PATH)) {
  sourcePNG = fs.readFileSync(USER_PNG_PATH);
  console.log(`[make-icons] using build/icon-source.png (${(sourcePNG.length / 1024).toFixed(1)} KB)`);
} else if (fs.existsSync(SVG_PATH)) {
  const svgText = fs.readFileSync(SVG_PATH, 'utf8');
  const m = svgText.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+?)["']/);
  if (!m) {
    console.error('[make-icons] could not locate base64 PNG inside SVG');
    process.exit(1);
  }
  sourcePNG = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  console.log(`[make-icons] extracted PNG from SVG (${(sourcePNG.length / 1024).toFixed(1)} KB)`);
} else {
  console.error('[make-icons] no icon source found (neither build/icon-source.png nor the SVG).');
  const fallback = makeSolidPNG(32, [74, 142, 224]);
  fs.writeFileSync(path.join(SRC_DIR, 'tray.png'), fallback);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), fallback);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), fallbackICO(fallback));
  process.exit(0);
}

(async () => {
  const img = await Jimp.read(sourcePNG);
  console.log(`[make-icons] source dimensions: ${img.bitmap.width}×${img.bitmap.height}`);

  // Trim transparent margin so the icon fills its square.
  const trimmed = await trimTransparent(img.clone());
  console.log(`[make-icons] trimmed to: ${trimmed.bitmap.width}×${trimmed.bitmap.height}`);

  // Produce PNG buffers at each icon size (square, centred on transparent bg).
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBySize = {};
  for (const s of sizes) {
    const square = await squareFit(trimmed, s);
    pngBySize[s] = await square.getBuffer('image/png');
  }

  // Emit outputs
  fs.writeFileSync(path.join(SRC_DIR,   'tray.png'), pngBySize[32]);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), pngBySize[256]);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), buildICO(sizes.map((s) => ({ size: s, png: pngBySize[s] }))));

  console.log(`[make-icons] wrote src/tray.png (${pngBySize[32].length} B)`);
  console.log(`[make-icons] wrote build/icon.png (${pngBySize[256].length} B)`);
  console.log(`[make-icons] wrote build/icon.ico with ${sizes.length} sizes`);
})().catch((e) => {
  console.error('[make-icons] failed:', e);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Trim fully-transparent rows/columns from the edges.
async function trimTransparent(image) {
  const { width, height, data } = image.bitmap;
  const alpha = (x, y) => data[(y * width + x) * 4 + 3];

  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  outerTop: for (; top < height; top++)
    for (let x = 0; x < width; x++) if (alpha(x, top) > 8) break outerTop;
  outerBot: for (; bottom >= 0; bottom--)
    for (let x = 0; x < width; x++) if (alpha(x, bottom) > 8) break outerBot;
  outerLeft: for (; left < width; left++)
    for (let y = 0; y < height; y++) if (alpha(left, y) > 8) break outerLeft;
  outerRight: for (; right >= 0; right--)
    for (let y = 0; y < height; y++) if (alpha(right, y) > 8) break outerRight;

  if (right <= left || bottom <= top) return image;

  return image.crop({ x: left, y: top, w: right - left + 1, h: bottom - top + 1 });
}

// Fit the content inside a size×size square with transparent padding so it
// doesn't touch the edges (nice for taskbar/tray rendering).
async function squareFit(trimmed, size) {
  // Tight padding so the Magna M fills the icon canvas — important for
  // small (16/24/32 px) tray + taskbar renderings where every pixel counts.
  const pad = Math.max(1, Math.floor(size * 0.02));
  const inner = size - pad * 2;
  const resized = trimmed.clone().contain({ w: inner, h: inner });
  const canvas = new Jimp({ width: size, height: size, color: 0x00000000 });
  canvas.composite(resized, pad, pad);
  return canvas;
}

function buildICO(entries) {
  // ICO header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);                // reserved
  header.writeUInt16LE(1, 2);                // type = icon
  header.writeUInt16LE(entries.length, 4);   // count

  const dir = Buffer.alloc(16 * entries.length);
  const images = [];
  let offset = 6 + 16 * entries.length;

  entries.forEach(({ size, png }, i) => {
    const e = 16 * i;
    dir[e]     = size === 256 ? 0 : size;    // width  (0 = 256)
    dir[e + 1] = size === 256 ? 0 : size;    // height (0 = 256)
    dir[e + 2] = 0;                           // palette
    dir[e + 3] = 0;                           // reserved
    dir.writeUInt16LE(1,  e + 4);            // planes
    dir.writeUInt16LE(32, e + 6);            // bit count
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset,     e + 12);
    offset += png.length;
    images.push(png);
  });

  return Buffer.concat([header, dir, ...images]);
}

// ---------------------------------------------------------------------------
// Fallback: solid-color PNG, used only if the brand SVG is missing.
// ---------------------------------------------------------------------------
function makeSolidPNG(size, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const off = y * stride + 1 + x * 4;
      raw[off] = r; raw[off+1] = g; raw[off+2] = b; raw[off+3] = 255;
    }
  }
  const compressed = deflateSync(raw);
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function fallbackICO(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = 32; dir[1] = 32; dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8); dir.writeUInt32LE(22, 12);
  return Buffer.concat([header, dir, png]);
}

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
