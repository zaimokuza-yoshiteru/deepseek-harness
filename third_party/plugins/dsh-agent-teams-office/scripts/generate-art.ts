import type { Pixels } from '../src/art/pixel-office.ts';
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeOffice, makeCharacters, makePreview } from '../src/art/pixel-office.ts';

// Small PNG encoder keeps art generation reproducible with Node alone.
function chunk(type: string, payload: Uint8Array) {
  const name = Buffer.from(type), data = Buffer.concat([name, payload]); let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(payload.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, data, sum]);
}
export function png(pixels: Pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(pixels.width, 0); header.writeUInt32BE(pixels.height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((pixels.width * 4 + 1) * pixels.height);
  for (let y = 0; y < pixels.height; y++) rows.set(pixels.data.subarray(y * pixels.width * 4, (y + 1) * pixels.width * 4), y * (pixels.width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
export async function generateArt() {
  const output = new URL('../src/assets/studio/', import.meta.url); await mkdir(output, { recursive: true });
  const { pixels, map } = makeOffice();
  await writeFile(new URL('office.png', output), png(pixels));
  await writeFile(new URL('characters.png', output), png(makeCharacters()));
  await writeFile(new URL('preview.png', output), png(makePreview(pixels)));
  await writeFile(new URL('office.tmj', output), JSON.stringify(map) + '\n');
  console.log('Generated original DSH Studio art: private Lead room + 16 desks, 17 avatars, 357 animation frames.');
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) await generateArt();
