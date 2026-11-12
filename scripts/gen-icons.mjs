#!/usr/bin/env node
/**
 * 生成 Tauri 打包所需图标：icons/32x32.png、icons/128x128.png、icons/icon.ico
 * 造型：纸飞机 + 文件夹（需求文档 §9.1），渐变 #2E6BE6 → #00B8C4（技术文档 §8.6 Logo 渐变）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Logo 绘制 ----------
function drawLogo(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const c1 = hex("#2E6BE6"), c2 = hex("#00B8C4");
  const inRR = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + r, Math.min(x1 - r, x));
    const cy = Math.max(y0 + r, Math.min(y1 - r, y));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
  };
  const inTri = (x, y, a, b, c) => {
    const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const d1 = sign([x, y], a, b), d2 = sign([x, y], b, c), d3 = sign([x, y], c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = (x / S + y / S) / 2;
      const lerp = c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
      let r = 0, g = 0, b = 0, a = 0;
      // 文件夹主体（圆角矩形 + 顶部标签页）
      const body = inRR(x, y, S * 0.1, S * 0.28, S * 0.9, S * 0.82, S * 0.07);
      const tab = inRR(x, y, S * 0.1, S * 0.18, S * 0.45, S * 0.34, S * 0.05);
      if (body || tab) { [r, g, b] = lerp; a = 255; }
      // 白色纸飞机（朝右上的三角组合）
      const p1 = [S * 0.42, S * 0.52], p2 = [S * 0.78, S * 0.36], p3 = [S * 0.5, S * 0.68];
      if (inTri(x, y, p1, p2, p3)) { r = 255; g = 255; b = 255; a = 235; }
      const i = (y * S + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  return px;
}

// ---------- ICO（内嵌 PNG）----------
function makeIco(pngs) {
  const count = pngs.length;
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size === 256 ? 0 : size; e[1] = size === 256 ? 0 : size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.png)]);
}

mkdirSync("src-tauri/icons", { recursive: true });
const png32 = encodePng(32, drawLogo(32));
const png128 = encodePng(128, drawLogo(128));
const png256 = encodePng(256, drawLogo(256));
writeFileSync("src-tauri/icons/32x32.png", png32);
writeFileSync("src-tauri/icons/128x128.png", png128);
writeFileSync("src-tauri/icons/icon.png", png256);
writeFileSync("src-tauri/icons/icon.ico", makeIco([
  { size: 32, png: png32 },
  { size: 128, png: png128 },
  { size: 256, png: png256 },
]));
console.log("✓ icons: 32x32.png, 128x128.png, icon.png, icon.ico");
