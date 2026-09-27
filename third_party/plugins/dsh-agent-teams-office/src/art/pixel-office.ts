// Original, deterministic pixel recipes. No imported images or third-party art.
// Coordinates are native pixels; the scene uses a 16 px grid and 16 × 32 avatars.
export const TILE = 16;
export const WIDTH = 56;
export const HEIGHT = 32;
export const SEATS = ['lead-desk', ...Array.from({ length: 16 }, (_, i) => `desk-${i + 1}`)];
export const LEAD_BOUNDS = { minX: 1, maxX: 14, minY: 4, maxY: 19 };
export const TEAM_BOUNDS = { minX: 17, maxX: 54, minY: 4, maxY: 30 };
export const PALETTES = [
  ['#648e9b', '#e6b991', '#303947'], ['#d39468', '#f2ccaa', '#5b403d'],
  ['#92ab80', '#a56e50', '#302e37'], ['#b293bd', '#e9bda0', '#543e47'],
  ['#ddae62', '#d79d77', '#393647'], ['#699ba6', '#875740', '#282e35'],
  ['#cd8791', '#f0c6a8', '#7c5140'], ['#8c9ab9', '#b9815e', '#343742'],
  ['#a0b49b', '#e8b48e', '#9b6845'], ['#c79072', '#f2ccaa', '#393440'],
  ['#839eaf', '#9c6649', '#272e38'], ['#c49bb5', '#e5aa82', '#7b544b'],
  ['#96a77a', '#dca781', '#4b4141'], ['#d3a358', '#a16c50', '#332d37'],
  ['#78a797', '#f0c6a8', '#805646'], ['#ac9ebf', '#c18a67', '#373641'],
  ['#c17f69', '#dba781', '#665541'],
];

export class Pixels {
  readonly data: Uint8Array;
  constructor(public readonly width: number, public readonly height: number) { this.data = new Uint8Array(width * height * 4); }
  rect(x: number, y: number, w: number, h: number, hex: string) {
    const n = Number.parseInt(hex.slice(1), 16), rgba = [n >> 16, (n >> 8) & 255, n & 255, 255];
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++)
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) this.data.set(rgba, (py * this.width + px) * 4);
  }
  blit(source: Pixels, x: number, y: number) {
    for (let sy = 0; sy < source.height; sy++) for (let sx = 0; sx < source.width; sx++) {
      const dx = x + sx, dy = y + sy, from = (sy * source.width + sx) * 4;
      if (source.data[from + 3] && dx >= 0 && dy >= 0 && dx < this.width && dy < this.height)
        this.data.set(source.data.subarray(from, from + 4), (dy * this.width + dx) * 4);
    }
  }
}
const C = { ink: '#354950', dark: '#293c43', shadow: '#9c957d', wood: '#c79264', woodLight: '#e2b681',
  cream: '#f2e4c8', teal: '#668e89', tealLight: '#8fafa0', leaf: '#658b69', leafLight: '#9eba7c' };
const glyphs: Record<string, string[]> = {
  A: ['010','101','111','101','101'], B: ['110','101','110','101','110'], C: ['011','100','100','100','011'],
  D: ['110','101','101','101','110'], E: ['111','100','110','100','111'], F: ['111','100','110','100','100'],
  H: ['101','101','111','101','101'], I: ['111','010','010','010','111'], L: ['100','100','100','100','111'],
  O: ['010','101','101','101','010'], R: ['110','101','110','101','101'], S: ['011','100','010','001','110'],
  V: ['101','101','101','101','010'],
  T: ['111','010','010','010','010'], U: ['101','101','101','101','111'], '0': ['111','101','101','101','111'],
  '1': ['010','110','010','010','111'], '2': ['110','001','010','100','111'], '3': ['110','001','010','001','110'],
  '4': ['101','101','111','001','001'], '5': ['111','100','110','001','110'], '6': ['011','100','111','101','111'],
  '7': ['111','001','010','010','010'], '8': ['111','101','111','101','111'], '9': ['111','101','111','001','110'],
};
function lettering(p: Pixels, text: string, x: number, y: number, color = C.cream, scale = 1) {
  for (const [i, char] of [...text].entries()) for (const [j, row] of (glyphs[char] ?? []).entries())
    for (const [k, bit] of [...row].entries()) if (bit === '1') p.rect(x + i * 4 * scale + k * scale, y + j * scale, scale, scale, color);
}
function box(p: Pixels, x: number, y: number, w: number, h: number, fill: string, border = C.ink) {
  p.rect(x, y, w, h, border); p.rect(x + 1, y + 1, w - 2, h - 2, fill);
}
function plant(p: Pixels, x: number, y: number, large = false) {
  const h = large ? 28 : 18;
  p.rect(x + 2, y + h + 1, 14, 3, C.shadow);
  box(p, x + 5, y + h - 8, 10, 9, '#bd8269'); p.rect(x + 6, y + h - 7, 2, 6, '#e2b08b');
  p.rect(x + 9, y + 3, 2, h - 9, C.leaf);
  for (let j = 0; j < (large ? 4 : 3); j++) {
    const yy = y + j * 5;
    p.rect(x + 3 - j % 2, yy + 1, 7, 4, C.leaf); p.rect(x + 5 - j % 2, yy, 5, 2, C.leafLight);
    p.rect(x + 10, yy + 3, 7, 4, '#527869'); p.rect(x + 11, yy + 2, 5, 2, '#83a67c');
  }
}
function chair(p: Pixels, x: number, y: number, accent = C.teal) {
  p.rect(x + 2, y + 13, 14, 3, '#677c75'); p.rect(x + 8, y + 7, 2, 7, C.ink);
  p.rect(x + 3, y + 13, 12, 2, C.ink); p.rect(x + 3, y + 15, 2, 1, C.dark); p.rect(x + 13, y + 15, 2, 1, C.dark);
  box(p, x + 3, y + 3, 12, 7, accent); box(p, x + 2, y, 14, 7, accent);
  p.rect(x + 4, y + 1, 10, 1, C.tealLight); p.rect(x, y + 5, 2, 4, C.ink); p.rect(x + 16, y + 5, 2, 4, C.ink);
}
function desk(p: Pixels, x: number, y: number, index: number) {
  p.rect(x + 2, y + 9, 48, 25, '#607e77');
  box(p, x + 3, y + 22, 5, 12, '#7f624f'); box(p, x + 40, y + 22, 5, 12, '#7f624f');
  box(p, x, y + 4, 48, 23, C.wood); p.rect(x + 2, y + 5, 44, 18, C.woodLight);
  p.rect(x + 2, y + 5, 44, 1, '#f4d3a0'); p.rect(x + 4, y + 21, 10, 1, '#d0a170');
  p.rect(x + 30, y + 8, 12, 1, '#d0a170'); p.rect(x + 31, y + 23, 10, 1, '#b88158');
  // Slate desk mat, monitor with a tiny code window, keyboard, notebook and mug.
  box(p, x + 12, y + 8, 25, 15, '#7d978d', '#9ba68b');
  p.rect(x + 22, y + 11, 3, 6, C.ink); p.rect(x + 19, y + 16, 9, 2, C.ink);
  box(p, x + 13, y, 22, 14, '#202f3b'); p.rect(x + 15, y + 2, 18, 9, '#344e5a');
  p.rect(x + 15, y + 2, 18, 2, '#557783');
  p.rect(x + 17, y + 6, 5, 1, '#9cc8b4'); p.rect(x + 19, y + 8, 9, 1, '#e7be81');
  p.rect(x + 17, y + 10, 7, 1, '#81adb7'); p.rect(x + 32, y + 12, 1, 1, '#b9d59b');
  box(p, x + 17, y + 19, 15, 4, '#bdc6b6');
  for (let k = 0; k < 6; k++) p.rect(x + 19 + k * 2, y + 20, 1, 1, '#758b88');
  p.rect(x + 34, y + 19, 3, 4, C.cream); box(p, x + 4, y + 12, 6, 8, '#e6d9bd', '#a78061');
  p.rect(x + 5, y + 14, 4, 1, '#9ba68b'); p.rect(x + 5, y + 16, 3, 1, '#9ba68b');
  p.rect(x + 40, y + 13, 4, 5, '#f6ebd1'); p.rect(x + 44, y + 14, 2, 3, '#f6ebd1');
  p.rect(x + 41, y + 13, 2, 1, '#815b46');
  box(p, x + 2, y + 24, index < 0 ? 18 : 10, 7, C.ink); lettering(p, index < 0 ? 'LEAD' : String(index + 1).padStart(2, '0'), x + 3, y + 25, '#c9d6bc');
  chair(p, x + 15, y + 33, index % 4 === 0 ? '#729b9d' : C.teal);
}
function windowArt(p: Pixels, x: number, y: number, w: number) {
  p.rect(x + 3, y + 3, w, 39, '#929883'); box(p, x, y, w, 38, '#91b5b6');
  p.rect(x + 3, y + 3, w - 6, 15, '#afcfd0'); p.rect(x + 3, y + 18, w - 6, 14, '#9bbbb8');
  // A quiet invented skyline, drawn from rectangles, behind the glass.
  for (let i = 0; i < w - 10; i += 13) {
    const hh = 5 + (i * 3 % 13); p.rect(x + 4 + i, y + 31 - hh, 10, hh, '#7fa2a8');
    for (let j = 0; j < 3; j++) p.rect(x + 6 + i, y + 30 - j * 4, 2, 1, '#c4d9cd');
  }
  p.rect(x + 8, y + 6, 28, 2, '#d8e6d3'); p.rect(x + 19, y + 8, 25, 2, '#d8e6d3');
  for (let i = 1; i < 4; i++) { p.rect(x + Math.floor(w * i / 4), y + 1, 3, 35, '#4e6a6c'); p.rect(x + Math.floor(w * i / 4) + 1, y + 1, 1, 35, '#b8c6b0'); }
  p.rect(x + 1, y + 32, w - 2, 4, '#ded4b7'); p.rect(x - 2, y + 36, w + 4, 3, C.cream);
}

function makeSharedOffice() {
  const WIDTH = 40;
  const p = new Pixels(WIDTH * TILE, HEIGHT * TILE), collision = Array(WIDTH * HEIGHT).fill(0), spawns = [];
  const block = (x: number, y: number, w: number, h: number) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) collision[yy * WIDTH + xx] = 1; };
  p.rect(0, 0, p.width, p.height, C.dark);
  // Warm plank floor, with sparse deterministic grain; no random build output.
  for (let y = 4; y < HEIGHT - 1; y++) for (let x = 1; x < WIDTH - 1; x++) {
    const px = x * TILE, py = y * TILE, shade = ['#c8ba96', '#cbbc9a', '#c5b794'][(x + y * 3) % 3];
    p.rect(px, py, 16, 16, shade); p.rect(px, py + 15, 16, 1, '#b5aa8b');
    if ((x + y % 2) % 4 === 0) p.rect(px, py, 1, 15, '#b5aa8b');
    if ((x * 7 + y * 3) % 5 === 0) p.rect(px + 4, py + 5, 6, 1, '#d6c6a0');
  }
  // Teal carpet encloses the working area. Insets leave generous circulation.
  box(p, 30, 94, 392, 388, '#6a8981', '#516f6a'); box(p, 33, 97, 386, 382, '#77968b', '#a4b1a0');
  for (let y = 101; y < 476; y += 4) for (let x = 37; x < 415; x += 4)
    p.rect(x, y, 1, 1, ((x + y) % 8) ? '#7e9b8f' : '#718e83');
  // Shell and high wall; the bottom cutaway stays low so characters remain visible.
  p.rect(12, 8, 616, 58, '#81968a'); p.rect(16, 12, 608, 49, '#afbaa0');
  p.rect(16, 12, 608, 2, '#cdd1b4'); p.rect(16, 61, 608, 5, '#5b736b'); p.rect(16, 66, 608, 2, '#e2cfaa');
  p.rect(8, 8, 8, 496, '#4b6662'); p.rect(624, 8, 8, 496, '#4b6662');
  p.rect(8, 8, 4, 496, '#7a9180'); p.rect(628, 8, 4, 496, '#7a9180');
  p.rect(8, 496, 624, 8, '#4b6662'); p.rect(12, 496, 616, 2, '#c0c6aa');
  block(0, 0, WIDTH, 4); block(0, 0, 1, HEIGHT); block(WIDTH - 1, 0, 1, HEIGHT); block(0, HEIGHT - 1, WIDTH, 1);
  windowArt(p, 48, 19, 144); windowArt(p, 256, 19, 144);
  box(p, 206, 20, 35, 29, '#e5d5b2'); p.rect(210, 24, 27, 21, '#506e6b');
  lettering(p, 'DSH', 212, 27, '#e9d3a7', 2); lettering(p, 'LAB', 216, 39, '#bdd0b0');
  // Wall board, with a non-semantic planning diagram (never fake team messages).
  box(p, 469, 21, 129, 33, '#f0e5c9', '#6e8072'); p.rect(472, 24, 123, 27, '#e6dbc1');
  lettering(p, 'IDEAS', 477, 27, '#65877c');
  for (let i = 0; i < 5; i++) { p.rect(479 + i * 23, 39, 15, 8, ['#d4ad74', '#a6baa1', '#a6bcc1'][i % 3]); p.rect(481 + i * 23, 41, 9, 1, '#f1e5cb'); }
  for (let i = 0; i < 16; i++) {
    const x = 3 + (i % 4) * 6, y = 7 + Math.floor(i / 4) * 6;
    desk(p, x * TILE, y * TILE, i); block(x, y, 3, 2);
    spawns.push({ name: SEATS[i + 1], x: (x + 1) * TILE, y: (y + 2) * TILE });
  }
  // Plants and open entry along the back wall.
  for (const x of [20, 424, 599]) { plant(p, x, 72, true); block(Math.floor(x / 16), 5, 1, 2); }
  // Kitchen counter with teal cabinets, sink, coffee machine, jars and tile backsplash.
  box(p, 469, 86, 130, 37, '#66847f'); p.rect(471, 87, 126, 10, '#e3d8ba');
  p.rect(471, 98, 126, 2, '#bda888');
  for (let x = 475; x < 593; x += 30) { box(p, x, 103, 25, 16, '#7d9b8c', '#56736d'); p.rect(x + 16, 106, 5, 1, '#c9d6b5'); }
  box(p, 512, 87, 30, 9, '#98aeaa'); box(p, 515, 89, 24, 5, '#567e84');
  p.rect(525, 80, 2, 11, '#3e5a61'); p.rect(527, 80, 6, 2, '#3e5a61');
  box(p, 478, 74, 22, 20, '#3b5055'); p.rect(480, 76, 18, 3, '#8aa9a0');
  p.rect(482, 82, 14, 10, '#243b42'); p.rect(486, 86, 6, 6, C.cream); p.rect(495, 80, 2, 2, '#ddb376');
  for (let x = 554; x < 581; x += 9) { box(p, x, 83, 6, 10, '#d4b787'); p.rect(x, 82, 6, 2, C.ink); }
  p.rect(586, 88, 7, 5, '#f0e4c7');
  block(29, 5, 9, 3);
  lettering(p, 'COFFEE', 511, 133, '#697f72');
  // Library: separate book spines, dividers and a trailing plant.
  box(p, 475, 166, 124, 34, '#927456');
  for (let row = 0; row < 2; row++) {
    p.rect(478, 169 + row * 15, 118, 12, '#5b6255');
    for (let i = 0; i < 22; i++) {
      const h = 8 + i % 4, xx = 480 + i * 5, yy = 181 + row * 15 - h;
      p.rect(xx, yy, 4, h, ['#a4b391', '#cda278', '#83a4ab', '#c18b80', '#d4c6a0'][i % 5]);
      p.rect(xx + 1, yy + 2, 2, 1, '#e9d7b4');
    }
  }
  p.rect(474, 165, 126, 2, '#d9b481'); block(29, 10, 9, 3);
  // Reading lounge: woven rug, cushioned sofa, tea table, side stool.
  box(p, 466, 226, 142, 100, '#b78c70', '#947960'); box(p, 469, 229, 136, 94, '#c9a584', '#e6c8a0');
  for (let yy = 234; yy < 319; yy += 7) p.rect(474, yy, 126, 1, '#bd997c');
  p.rect(478, 246, 117, 5, '#9b8068'); box(p, 478, 216, 113, 31, '#647f81');
  p.rect(481, 218, 107, 8, '#8da6a0');
  for (let i = 0; i < 3; i++) { box(p, 484 + i * 33, 225, 31, 18, '#7f9992', '#5d787a'); p.rect(486 + i * 33, 226, 27, 1, '#adc0ac'); }
  box(p, 476, 221, 8, 25, '#6f8d8a'); box(p, 585, 221, 8, 25, '#6f8d8a');
  box(p, 490, 224, 12, 13, '#d6b080'); p.rect(492, 226, 8, 1, '#efcf9c');
  box(p, 557, 224, 12, 13, '#c48c7c');
  box(p, 506, 274, 65, 26, C.wood); p.rect(509, 275, 59, 20, C.woodLight);
  box(p, 515, 280, 14, 10, '#6e9294'); p.rect(517, 282, 10, 1, '#c9d8bb');
  p.rect(546, 282, 6, 6, C.cream); p.rect(552, 283, 2, 3, C.cream); p.rect(548, 282, 3, 1, '#795b4a');
  plant(p, 595, 207, true); block(29, 13, 9, 3); block(31, 17, 5, 2);
  // Small meeting corner, with a generous accessible aisle from the main room.
  box(p, 470, 353, 138, 123, '#b6b798', '#929d83');
  p.rect(473, 356, 132, 117, '#c6c5a5');
  chair(p, 504, 366); chair(p, 551, 366);
  box(p, 496, 384, 90, 44, C.wood); p.rect(498, 386, 86, 36, '#dcb484');
  p.rect(500, 387, 82, 1, '#f0cda0'); p.rect(539, 387, 1, 34, '#c99b6c');
  box(p, 509, 396, 18, 12, '#e9dfc1'); p.rect(511, 398, 13, 1, '#92a397'); p.rect(511, 401, 10, 1, '#92a397');
  box(p, 553, 393, 19, 14, '#455f67'); p.rect(555, 395, 15, 10, '#80a8ae'); p.rect(551, 407, 23, 3, '#c6cfc1');
  plant(p, 531, 395); chair(p, 504, 435); chair(p, 551, 435);
  block(31, 24, 6, 3); block(31, 23, 2, 1); block(34, 23, 2, 1); block(31, 27, 2, 2); block(34, 27, 2, 2);
  plant(p, 588, 439, true); block(37, 28, 1, 2);
  // Entry threshold in the cutaway wall.
  p.rect(431, 488, 29, 16, '#b49f7d'); p.rect(432, 488, 27, 2, '#e4cc9e');
  lettering(p, 'STUDIO', 513, 460, '#728677');
  spawns.push({ name: 'entrance', x: 27 * TILE, y: 30 * TILE });
  const map = { width: WIDTH, height: HEIGHT, tilewidth: TILE, tileheight: TILE, orientation: 'orthogonal', renderorder: 'right-down',
    layers: [
      { name: 'floor', type: 'tilelayer', width: WIDTH, height: HEIGHT, data: Array.from({ length: WIDTH * HEIGHT }, (_, i) => i + 1) },
      { name: 'collision', type: 'tilelayer', width: WIDTH, height: HEIGHT, data: collision },
      { name: 'spawn-points', type: 'objectgroup', objects: spawns },
      { name: 'zones', type: 'objectgroup', objects: [{ name: 'office', x: 32, y: 96, width: 384, height: 384 }, { name: 'lounge', x: 464, y: 224, width: 144, height: 112 }] },
    ], tilesets: [{ firstgid: 1, name: 'DSH Studio', image: 'office.png', imagewidth: p.width, imageheight: p.height,
      columns: WIDTH, tilewidth: TILE, tileheight: TILE, tilecount: WIDTH * HEIGHT }] };
  return { pixels: p, map };
}

/** Add a private Lead wing without altering the sixteen teammate desks. */
export function makeOffice() {
  const base = makeSharedOffice(), p = new Pixels(WIDTH * TILE, HEIGHT * TILE);
  const collision = Array(WIDTH * HEIGHT).fill(0), shift = 16;
  const block = (x: number, y: number, w: number, h: number) => { for (let yy=y; yy<y+h; yy++) for(let xx=x;xx<x+w;xx++) collision[yy*WIDTH+xx]=1; };
  p.rect(0,0,256,512,C.dark);
  for(let y=4;y<31;y++) for(let x=1;x<16;x++) {
    p.rect(x*TILE,y*TILE,16,16,(x+y)%2 ? '#d5c3a0' : '#d0bf9d');
    p.rect(x*TILE,y*TILE+15,16,1,'#bbaa8c');
  }
  p.blit(base.pixels,256,0);
  const original = base.map.layers.find(layer=>layer.name==='collision')!.data!;
  for(let y=0;y<HEIGHT;y++) for(let x=0;x<40;x++) collision[y*WIDTH+x+shift]=original[y*40+x];
  // Lead room wall, open doorway on the right, and public archive below.
  p.rect(8,8,248,58,'#afbaa0');p.rect(8,61,248,7,'#5b736b');
  p.rect(8,8,8,496,'#658178');p.rect(8,496,248,8,'#4b6662');
  p.rect(240,64,16,432,'#7d978a');p.rect(240,64,3,432,'#b8c4aa');
  p.rect(16,320,224,12,'#789386');p.rect(16,320,224,3,'#c8d0b3');
  block(0,0,16,4);block(0,0,1,32);block(0,31,16,1);block(15,4,1,27);block(1,20,14,1);
  for(const y of [15,26]) {
    p.rect(240,y*TILE,32,32,'#cfbf9d');
    for(let yy=y;yy<y+2;yy++) for(const x of [15,16]) collision[yy*WIDTH+x]=0;
  }
  windowArt(p,40,19,144); lettering(p,'LEAD',195,32,'#4b6d68');
  box(p,39,91,175,204,'#81998b','#a8b9a0');
  desk(p,96,112,-1);block(6,7,3,2);
  plant(p,24,77,true);plant(p,208,77,true);block(1,5,2,2);block(13,5,2,2);
  // Visitor seating leaves a wide centre aisle to the doorway.
  box(p,44,229,62,28,'#bcaa78');box(p,44,220,62,12,'#d3bf88');
  box(p,43,223,9,33,'#b19c6b');box(p,99,223,9,33,'#b19c6b');block(2,13,5,3);
  box(p,133,242,42,22,C.wood);box(p,137,239,34,17,C.woodLight);block(8,15,3,2);
  // Public archive below the partition; decorative books and reading table.
  lettering(p,'ARCHIVE',68,354,'#658178');
  for(let shelf=0;shelf<3;shelf++) {
    box(p,30,372+shelf*27,55,23,C.wood);
    for(let i=0;i<8;i++) box(p,34+i*6,374+shelf*27,5,16-(i%3),['#7c9da5','#bb8770','#cdb47d'][i%3]);
  }
  block(1,23,5,6);box(p,133,418,53,25,C.woodLight);block(8,26,4,2);chair(p,149,449);block(9,28,2,2);
  plant(p,206,460,true);block(13,29,1,2);
  // Activity props: public water cooler, hinged fridge and waste bin.
  box(p,831,86,12,36,'#d1dfd2');box(p,833,77,8,13,'#82b6c2');p.rect(835,99,4,5,'#527d85');
  box(p,861,81,17,40,'#d7dfcc');p.rect(862,96,15,2,'#a0b3a6');p.rect(873,102,2,8,'#6e8b88');block(54,5,1,3);
  box(p,868,473,11,16,'#708e83');p.rect(867,472,13,3,'#526f69');block(54,30,1,1);
  // Lead's kitchenette and book cabinet remain inside its roaming bounds.
  box(p,28,130,39,24,'#8da794');box(p,28,128,39,5,'#e1d5b7');box(p,32,116,15,15,'#496c71');
  p.rect(51,130,12,4,'#597e85');block(1,8,4,2);
  box(p,171,66,43,13,'#ae8864');for(let i=0;i<7;i++)p.rect(174+i*5,67,4,10,['#90b0b1','#d0af7a','#b98e81'][i%3]);
  const spawns = [{ name: SEATS[0], x: 7*TILE, y: 9*TILE },
    ...base.map.layers.find(layer=>layer.name==='spawn-points')!.objects!.map(item=>({...item,x:item.x+256})),
    {name:'lead-door',x:15*TILE,y:15*TILE}, {name:'lead-visitor',x:12*TILE,y:13*TILE}];
  const zones = base.map.layers.find(layer=>layer.name==='zones')!.objects!.map(item=>({...item,x:item.x+256}));
  zones.push({name:'lead-office',x:16,y:64,width:224,height:256});
  const map = {...base.map,width:WIDTH,layers:[
    {name:'floor',type:'tilelayer',width:WIDTH,height:HEIGHT,data:Array.from({length:WIDTH*HEIGHT},(_,i)=>i+1)},
    {name:'collision',type:'tilelayer',width:WIDTH,height:HEIGHT,data:collision},
    {name:'spawn-points',type:'objectgroup',objects:spawns}, {name:'zones',type:'objectgroup',objects:zones},
  ],tilesets:[{...base.map.tilesets[0],imagewidth:p.width,columns:WIDTH,tilecount:WIDTH*HEIGHT}]};
  return {pixels:p,map};
}

// Seven frames per direction: stand / two steps / two typing / two reading.
// A real profile is drawn for side-facing avatars; left mirrors right in Pixi.
export function avatar(index: number, direction: number, frame: number) {
  const p = new Pixels(16, 32), [shirt, skin, hair] = PALETTES[index], side = direction === 2, back = direction === 1;
  const step = frame === 1 ? -1 : frame === 2 ? 1 : 0, bob = step ? 1 : 0;
  const r = (x: number, y: number, w: number, h: number, color: string) => p.rect(x, y + bob, w, h, color);
  p.rect(4, 30, 9, 1, '#536c66');
  r(4, 22, side ? 7 : 8, 5, '#344958');
  r(4, 27, 3, 3 + Math.min(step, 0), '#405a65'); r(9, 27, 3, 3 - Math.max(step, 0), '#405a65');
  r(3 + (side ? step : 0), 29 + Math.min(step, 0), 4, 2, '#293d48');
  r(9 - (side ? step : 0), 29 - Math.max(step, 0), 4, 2, '#293d48');
  r(4, 14, 8, 10, C.ink); r(5, 14, 6, 9, shirt); r(4, 16, 8, 6, shirt);
  r(5, 15, 1, 7, '#d6d5b5'); r(7, 13, 3, 3, skin);
  if (!back) { r(7, 15, 2, 3, '#efe4ca'); if (index === 0) r(8, 17, 1, 5, '#42576e'); }
  const arm = step;
  r(2, 16, 3, 6, shirt); r(11, 16, 3, 6, shirt);
  if (frame >= 3 && frame <= 4) {
    r(side ? 11 : 2, 17 + frame % 2, side ? 4 : 3, 3, skin); r(side ? 10 : 11, 18 - frame % 2, 3, 3, skin);
  } else if (frame >= 5) {
    r(3, 19, 10, 5, '#efe1bd'); r(8, 19, 1, 5, '#ab9377'); r(3, 20 + frame % 2, 2, 2, skin); r(11, 21, 2, 2, skin);
  } else { r(2, 21 + arm, 3, 3, skin); r(11, 21 - arm, 3, 3, skin); }
  // Rounded, outlined head with small ears, hair silhouettes, and varied accessories.
  r(side ? 5 : 4, 3, 8, 11, hair); r(3, 5, 11, 7, hair);
  if (back) {
    r(4, 6, 9, 6, hair); r(5, 12, 6, 2, hair); r(3, 10, 1, 2, skin); r(13, 10, 1, 2, skin);
    if (index % 4 === 3) { r(4, 9, 9, 8, hair); r(6, 7, 5, 2, '#96735f'); }
    else r(5, 4, 5, 1, '#7e6960');
  } else {
    r(side ? 8 : 4, 7, side ? 6 : 9, 6, skin); r(side ? 9 : 5, 13, side ? 4 : 7, 1, skin);
    r(side ? 13 : 3, 9, 2, 3, skin); r(5, 4, 7, 3, hair); r(4, 6, 3, 3, hair);
    if (side) { r(12, 9, 1, 2, C.dark); r(14, 10, 1, 2, skin); r(12, 12, 2, 1, '#b37b66'); }
    else { r(6, 9, 1, 2, C.dark); r(10, 9, 1, 2, C.dark); r(8, 12, 2, 1, '#a7695b'); }
    if (index % 4 === 1) { r(4, 8, 4, 4, '#465665'); r(9, 8, 4, 4, '#465665'); r(5, 9, 2, 2, '#a5c7bc'); r(10, 9, 2, 2, '#a5c7bc'); r(8, 9, 1, 1, '#465665'); }
    if (index % 4 === 2) { r(3, 4, 10, 3, hair); r(4, 3, 2, 1, hair); r(8, 2, 2, 2, hair); }
    if (index % 4 === 3) { r(3, 8, 2, 9, hair); if (!side) r(12, 8, 2, 9, hair); r(12, 15, 2, 2, shirt); }
  }
  return p;
}

export function makeCharacters() {
  const p = new Pixels(16 * 7, PALETTES.length * 32 * 3);
  for (let i = 0; i < PALETTES.length; i++) for (let d = 0; d < 3; d++) for (let f = 0; f < 7; f++) p.blit(avatar(i, d, f), f * 16, (i * 3 + d) * 32);
  return p;
}

export function makePreview(office: Pixels) {
  const p = new Pixels(office.width, office.height); p.blit(office, 0, 0);
  const points = makeOffice().map.layers.find(layer => layer.name === 'spawn-points')!.objects!;
  for (let index = 0; index < SEATS.length; index++) {
    const point = points.find(item => item.name === SEATS[index]), seated = avatar(index, 1, 3);
    seated.data.fill(0, 16 * 24 * 4); p.blit(seated, point!.x, point!.y - 11);
  }
  return p;
}
