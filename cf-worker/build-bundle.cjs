#!/usr/bin/env node
// Builds the Raspberry Pi host bundle and the Worker's embedded copy of it:
//   - led-rings-host-bundle.zip   (repo root)  — what the operator downloads for the Pi
//   - cf-worker/bundle.js         (BUNDLE_B64) — the same zip, base64'd, served by the Worker
//
// Pure Node, zero dependencies (matches bridge.js). Run:  node cf-worker/build-bundle.cjs
//
// SAFETY: the bundle is built ONLY from the token-free sources listed below. The real secret
// (remote-deploy/.led-rings-secrets) is NEVER included — only the .example template is, so the
// operator fills in their own token on the Pi. Both outputs are gitignored build artifacts;
// regenerate them here rather than editing bundle.js by hand.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'remote-deploy');
const FILES = [
  'bridge.js',
  'FRIEND-SETUP.md',
  'led-rings-host.sh',
  'led-rings-host-run.sh',
  'led-rings-host-stop.sh',
  'led-rings-host-enable-autostart.sh',
  '.led-rings-secrets.example',
];

// ---- CRC32 (for the zip entries) ----
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
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0, 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };

// Fixed DOS timestamp (1980-01-01 00:00) keeps the output byte-for-byte reproducible.
const DOS_TIME = u16(0);
const DOS_DATE = u16((1 << 5) | 1);

// ---- Build the zip (STORE method — no compression; the payload is a few KB of scripts) ----
const locals = [];
const centrals = [];
let offset = 0;
for (const name of FILES) {
  const data = fs.readFileSync(path.join(SRC, name));
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const lfh = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), DOS_TIME, DOS_DATE,
    u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf,
  ]);
  locals.push(lfh, data);
  const cdh = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), DOS_TIME, DOS_DATE,
    u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(offset), nameBuf,
  ]);
  centrals.push(cdh);
  offset += lfh.length + data.length;
}
const localData = Buffer.concat(locals);
const centralDir = Buffer.concat(centrals);
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(FILES.length), u16(FILES.length),
  u32(centralDir.length), u32(localData.length), u16(0),
]);
const zip = Buffer.concat([localData, centralDir, eocd]);

const zipPath = path.join(ROOT, 'led-rings-host-bundle.zip');
const bundleJsPath = path.join(__dirname, 'bundle.js');
fs.writeFileSync(zipPath, zip);
fs.writeFileSync(bundleJsPath, `export const BUNDLE_B64 = ${JSON.stringify(zip.toString('base64'))};\n`);
console.log(`Built ${FILES.length} files -> led-rings-host-bundle.zip (${zip.length} bytes) + cf-worker/bundle.js`);
