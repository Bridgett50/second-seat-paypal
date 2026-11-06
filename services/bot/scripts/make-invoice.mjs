// Generates fixture invoice-31.png (#31 invoice, synthetic) + invoice-31.boxes.json.
// Minimal PNG writer: 8-bit RGB, non-interlaced, node:zlib only.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pii");
const W = 800;
const H = 400;

const px = Buffer.alloc(W * H * 3, 255);
// PII bars (dark bands) whose boxes go into the sidecar.
const bars = [
  { x: 120, y: 90, w: 300, h: 26, label: "phone" },
  { x: 120, y: 130, w: 340, h: 26, label: "email" },
  { x: 120, y: 170, w: 320, h: 26, label: "card" },
  { x: 120, y: 210, w: 360, h: 26, label: "address" },
];
for (const b of bars) {
  for (let y = b.y; y < b.y + b.h; y += 1)
    for (let x = b.x; x < b.x + b.w; x += 1) {
      px[(y * W + x) * 3] = 30;
      px[(y * W + x) * 3 + 1] = 30;
      px[(y * W + x) * 3 + 2] = 30;
    }
}
const filtered = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y += 1) {
  filtered[y * (W * 3 + 1)] = 0;
  px.copy(filtered, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const table = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
const crc = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const td = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const cc = Buffer.alloc(4);
  cc.writeUInt32BE(crc(Buffer.concat([td, data])), 0);
  return Buffer.concat([len, td, data, cc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", Buffer.from(deflateSync(filtered))),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(join(dir, "invoice-31.png"), png);
writeFileSync(join(dir, "invoice-31.boxes.json"), JSON.stringify(bars, null, 2));
console.log("wrote invoice-31.png + invoice-31.boxes.json");
