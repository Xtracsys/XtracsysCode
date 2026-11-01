/**
 * Generates build/icon.png (1024x1024) without any image dependencies:
 * dark rounded square, orange "X" bracket mark, subtle inner frame.
 * Run: node scripts/icon.js
 */
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 1024;

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngFromRgba(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing helpers ---
const px = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const srcA = a / 255;
  const dstA = px[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  px[i] = Math.round((r * srcA + px[i] * dstA * (1 - srcA)) / outA);
  px[i + 1] = Math.round((g * srcA + px[i + 1] * dstA * (1 - srcA)) / outA);
  px[i + 2] = Math.round((b * srcA + px[i + 2] * dstA * (1 - srcA)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

function fillRounded(x0, y0, x1, y1, radius, col) {
  for (let y = Math.floor(y0); y < y1; y++) {
    for (let x = Math.floor(x0); x < x1; x++) {
      const dx = Math.max(x0 + radius - x, x - (x1 - radius - 1), 0);
      const dy = Math.max(y0 + radius - y, y - (y1 - radius - 1), 0);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= radius) {
        const a = d > radius - 1.5 ? 255 * (radius - d) / 1.5 : 255;
        setPixel(x, y, col[0], col[1], col[2], Math.min(255, a) * (col[3] ?? 255) / 255);
      }
    }
  }
}

function fillRect(x0, y0, x1, y1, col) {
  fillRounded(x0, y0, x1, y1, 0, col);
}

// Background: dark rounded square filling the canvas (Apple icons need edge-to-edge art; electron-builder/iOS-style rounding not applied for macOS — keep slight margin)
const BG = [24, 22, 26];
const BG2 = [34, 31, 38];
const ACCENT = [224, 120, 79]; // #e0784f
const DIM = [90, 84, 96];

fillRounded(32, 32, SIZE - 32, SIZE - 32, 180, [...BG, 255]);
// subtle vertical gradient: blend BG2 rows near top
for (let y = 32; y < 400; y++) {
  const t = (400 - y) / (400 - 32) * 0.5;
  for (let x = 32; x < SIZE - 32; x++) {
    const i = (y * SIZE + x) * 4;
    px[i] = Math.round(BG[0] * (1 - t) + BG2[0] * t);
    px[i + 1] = Math.round(BG[1] * (1 - t) + BG2[1] * t);
    px[i + 2] = Math.round(BG[2] * (1 - t) + BG2[2] * t);
  }
}

// Inner frame (thin outline)
const frame = [...DIM, 140];
fillRect(180, 180, SIZE - 180, 188, frame);
fillRect(180, SIZE - 188, SIZE - 180, SIZE - 180, frame);
fillRect(180, 180, 188, SIZE - 180, frame);
fillRect(SIZE - 188, 180, SIZE - 180, SIZE - 180, frame);

// X mark: two thick diagonal strokes through the center, in accent color,
// drawn as rotated rectangles via distance field.
function diagStroke(cx, cy, halfLen, thickness, angleSign, col) {
  for (let y = 200; y < SIZE - 200; y++) {
    for (let x = 200; x < SIZE - 200; x++) {
      const lx = x - cx;
      const ly = y - cy;
      // rotate into stroke frame
      const u = (lx * angleSign + ly) / Math.SQRT2; // along stroke
      const v = (-lx * angleSign + ly) / Math.SQRT2; // across stroke
      if (Math.abs(u) <= halfLen && Math.abs(v) <= thickness) {
        setPixel(x, y, col[0], col[1], col[2], 255);
      } else if (Math.abs(u) <= halfLen && Math.abs(v) <= thickness + 1.5) {
        const a = 255 * (1 - (Math.abs(v) - thickness) / 1.5);
        if (a > 0) setPixel(x, y, col[0], col[1], col[2], a);
      }
    }
  }
}

const C = SIZE / 2;
diagStroke(C, C, 240, 34, 1, [...ACCENT, 255]);
diagStroke(C, C, 240, 34, -1, [...ACCENT, 255]);

// Terminal cursor block: small filled square at bottom-right of the X
fillRounded(SIZE / 2 + 150, SIZE / 2 + 150, SIZE / 2 + 230, SIZE / 2 + 230, 14, [...ACCENT, 255]);

const out = path.join(__dirname, "..", "build", "icon.png");
fs.writeFileSync(out, pngFromRgba(SIZE, SIZE, px));
console.log("wrote", out, fs.statSync(out).size, "bytes");

// --- Windows icon: 256px PNG embedded in an .ico container (valid since Vista). ---
const ICO_SIZE = 256;
const SCALE = SIZE / ICO_SIZE;
const small = Buffer.alloc(ICO_SIZE * ICO_SIZE * 4);
for (let y = 0; y < ICO_SIZE; y++) {
  for (let x = 0; x < ICO_SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) {
        const i = ((y * SCALE + dy) * SIZE + x * SCALE + dx) * 4;
        r += px[i] * px[i + 3];
        g += px[i + 1] * px[i + 3];
        b += px[i + 2] * px[i + 3];
        a += px[i + 3];
      }
    }
    const n = SCALE * SCALE * 255;
    const j = (y * ICO_SIZE + x) * 4;
    small[j] = Math.round(r / n);
    small[j + 1] = Math.round(g / n);
    small[j + 2] = Math.round(b / n);
    small[j + 3] = Math.round(a / (SCALE * SCALE));
  }
}
const png256 = pngFromRgba(ICO_SIZE, ICO_SIZE, small);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = ICO_SIZE % 256; // width (0 = 256)
entry[1] = ICO_SIZE % 256; // height
entry[2] = 0; // palette
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png256.length, 8);
entry.writeUInt32LE(22, 12); // offset: 6 + 16
const icoOut = path.join(__dirname, "..", "build", "icon.ico");
fs.writeFileSync(icoOut, Buffer.concat([header, entry, png256]));
console.log("wrote", icoOut, fs.statSync(icoOut).size, "bytes");
