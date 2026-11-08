/*
 * Map data shared by the 2D and 3D views.
 *
 * map entity: kind 'map', fields {
 *   size: N (grid is N×N), heights: base64 Float32Array (0..1), paint: base64 Uint8Array (biome per cell, 0 = automatic),
 *   seaLevel: 0..1, heightScale: number, image?: dataURL, useImage: boolean (show picture instead of biome colours),
 *   pins: Pin[] (u,v in 0..1, same in both views), view: '2d' | '3d', lowPoly: boolean,
 *   hfmt?: 'u16' (heights stored as 16-bit numbers: half the size), objects?: MapObject[]
 * }
 */

/* ---------- sizes ---------- */
export const MAP_SIZES: { id: string; N: number; label: string; sub: string }[] = [
  { id: 'small', N: 160, label: 'Small', sub: 'An island or a region' },
  { id: 'medium', N: 320, label: 'Medium', sub: 'A country' },
  { id: 'large', N: 512, label: 'Large', sub: 'Several countries' },
  { id: 'huge', N: 800, label: 'Huge', sub: 'A continent' },
  { id: 'giant', N: 1280, label: 'Giant', sub: 'A whole world' },
];
export const MAX_N = 1280;
/** width of the land in 3D units (the first maps were 160 cells = 100 units; every size keeps that cell size) */
export const worldSize = (N: number) => (100 * (N - 1)) / 159;
/** the size name, or the nearest one for maps made when the sizes were different */
export const sizeLabel = (N: number) => MAP_SIZES.reduce((a, b) => (Math.abs(Math.log(b.N / N)) < Math.abs(Math.log(a.N / N)) ? b : a)).label;

/* ---------- things you can place ---------- */
export type ObjKind = 'house' | 'cottage' | 'tower' | 'castle' | 'wall' | 'bridge' | 'tent' | 'well' | 'flag' | 'tree' | 'pine' | 'rock';
export interface MapObject { id: string; kind: ObjKind; u: number; v: number; u2?: number; v2?: number; rot: number; scale: number; color?: string }
export const OBJECTS: { kind: ObjKind; label: string; group: string; line?: boolean; color: string }[] = [
  { kind: 'house', label: 'House', group: 'Buildings', color: '#c9b18a' },
  { kind: 'cottage', label: 'Cottage', group: 'Buildings', color: '#d8c7a0' },
  { kind: 'tower', label: 'Tower', group: 'Buildings', color: '#9a958c' },
  { kind: 'castle', label: 'Castle', group: 'Buildings', color: '#a7a198' },
  { kind: 'tent', label: 'Tent', group: 'Buildings', color: '#d9c9a3' },
  { kind: 'well', label: 'Well', group: 'Buildings', color: '#8f8a82' },
  { kind: 'wall', label: 'Wall', group: 'Lines', line: true, color: '#8f8a82' },
  { kind: 'bridge', label: 'Bridge', group: 'Lines', line: true, color: '#8a6a48' },
  { kind: 'tree', label: 'Tree', group: 'Nature', color: '#3f7d3a' },
  { kind: 'pine', label: 'Pine', group: 'Nature', color: '#2d5e3a' },
  { kind: 'rock', label: 'Rock', group: 'Nature', color: '#8d8a86' },
  { kind: 'flag', label: 'Flag', group: 'Markers', color: '#e06c75' },
];
export const objDef = (k: ObjKind) => OBJECTS.find((o) => o.kind === k)!;

export interface Pin { id: string; u: number; v: number; label: string; entityId?: string; color: string }

export const BIOMES: { id: number; name: string; color: [number, number, number] }[] = [
  { id: 0, name: 'Automatic (by height)', color: [0, 0, 0] },
  { id: 1, name: 'Grassland', color: [110, 160, 80] },
  { id: 2, name: 'Forest', color: [52, 102, 58] },
  { id: 3, name: 'Sand / beach', color: [214, 196, 140] },
  { id: 4, name: 'Desert', color: [222, 178, 110] },
  { id: 5, name: 'Rock', color: [128, 120, 112] },
  { id: 6, name: 'Snow', color: [240, 244, 248] },
  { id: 7, name: 'Swamp', color: [84, 100, 70] },
  { id: 8, name: 'Farmland', color: [176, 168, 92] },
  { id: 9, name: 'Tundra', color: [160, 166, 150] },
  { id: 10, name: 'Volcanic', color: [70, 52, 50] },
  { id: 11, name: 'Settlement', color: [176, 120, 96] },
  { id: 12, name: 'Road', color: [150, 126, 96] },
];

export const DEEP: [number, number, number] = [28, 64, 110];
export const SHALLOW: [number, number, number] = [56, 120, 168];

export function autoColor(h: number, sea: number): [number, number, number] {
  if (h < sea) { const t = Math.max(0, Math.min(1, (sea - h) / 0.25)); return mix(SHALLOW, DEEP, t); }
  const a = (h - sea) / Math.max(0.0001, 1 - sea);
  if (a < 0.04) return BIOMES[3].color;
  if (a < 0.35) return mix(BIOMES[1].color, BIOMES[2].color, a / 0.35);
  if (a < 0.62) return mix(BIOMES[2].color, BIOMES[5].color, (a - 0.35) / 0.27);
  if (a < 0.82) return mix(BIOMES[5].color, [150, 146, 140], (a - 0.62) / 0.2);
  return BIOMES[6].color;
}
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function cellColor(h: number, paint: number, sea: number): [number, number, number] {
  if (h < sea && paint !== 12 && paint !== 11) return autoColor(h, sea);
  return paint ? BIOMES[paint]?.color ?? autoColor(h, sea) : autoColor(h, sea);
}

/* ---------- encoding ---------- */
/** heights as 16-bit numbers (plenty of detail, half the size of 32-bit) */
export function encodeHeights(h: Float32Array): string {
  const u = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) u[i] = Math.round(Math.max(0, Math.min(1, h[i])) * 65535);
  return encode(new Uint8Array(u.buffer));
}
export function decodeHeights(b64: string | undefined, n: number, fmt?: unknown): Float32Array {
  if (fmt !== 'u16') return decodeF32(b64, n);
  if (!b64) return new Float32Array(n);
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const u = new Uint16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  if (u.length !== n) return new Float32Array(n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = u[i] / 65535;
  return out;
}

/** Make a map bigger: the old land sits in the middle, with open sea (or flat land) around it */
export function expandMap(h: Float32Array, paint: Uint8Array, N: number, N2: number, fill: number) {
  const off = Math.floor((N2 - N) / 2);
  const h2 = new Float32Array(N2 * N2).fill(fill), p2 = new Uint8Array(N2 * N2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { h2[(y + off) * N2 + x + off] = h[y * N + x]; p2[(y + off) * N2 + x + off] = paint[y * N + x]; }
  // soften the old edge so it doesn't end in a cliff
  const band = Math.min(12, off);
  for (let y = 0; y < N2; y++) for (let x = 0; x < N2; x++) {
    const ix = x - off, iy = y - off;
    const d = Math.max(Math.max(-ix, ix - (N - 1)), Math.max(-iy, iy - (N - 1)));
    if (d > 0 && d <= band) {
      const cx = Math.max(0, Math.min(N - 1, ix)), cy = Math.max(0, Math.min(N - 1, iy));
      const t = d / band;
      h2[y * N2 + x] = h[cy * N + cx] * (1 - t * t * (3 - 2 * t)) + fill * (t * t * (3 - 2 * t));
    }
  }
  const remap = (u: number) => (u * (N - 1) + off) / (N2 - 1);
  return { h: h2, p: p2, remap };
}
export function encode(arr: Float32Array | Uint8Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeF32(b64: string | undefined, n: number): Float32Array {
  if (!b64) return new Float32Array(n);
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const f = new Float32Array(bytes.buffer);
  return f.length === n ? f : new Float32Array(n);
}
export function decodeU8(b64: string | undefined, n: number): Uint8Array {
  if (!b64) return new Uint8Array(n);
  const bin = atob(b64); const out = new Uint8Array(n);
  for (let i = 0; i < Math.min(n, bin.length); i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- terrain generation ---------- */
// hash-based value noise: no repeating pattern, however big the map
const hash = (x: number, y: number, s: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y); let xf = x - xi, yf = y - yi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  const t = a + (b - a) * xf, u = c + (d - c) * xf; return t + (u - t) * yf;
}
function fbm(x: number, y: number, f: number, oct: number, s: number) {
  let v = 0, amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) { v += noise(x * f, y * f, s + o * 101) * amp; tot += amp; amp *= 0.5; f *= 2; }
  return v / tot;
}

export type Shape = 'island' | 'archipelago' | 'continent' | 'mountains' | 'flat';

/**
 * Hills, coasts and mountains are the same real size on every map, so a bigger map is a bigger world
 * with more of them (not the same island stretched out). Where the land masses go scales with the map.
 */
export function generate(N: number, shape: Shape, seed = Math.floor(Math.random() * 1e9)): Float32Array {
  const h = new Float32Array(N * N);
  if (shape === 'flat') return h.fill(0.32);
  const k = N / 160; // how many small maps fit across
  const lands = shape === 'continent' ? 1.4 + k * 0.55 : shape === 'island' ? 1.2 + k * 0.25 : 1.2 + k * 0.35;
  const detailF = (shape === 'archipelago' ? 5 : shape === 'mountains' ? 4 : 3) / 160;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ux = x / (N - 1), uy = y / (N - 1);
    const dx = ux - 0.5, dy = uy - 0.5, d = Math.sqrt(dx * dx + dy * dy) * 2;
    const edge = Math.max(0, Math.max(Math.abs(dx), Math.abs(dy)) * 2 - 0.8) / 0.2; // 0 inside, 1 at the edge
    const big = fbm(ux, uy, lands, 3, seed + 7);
    const det = fbm(x, y, detailF, 5, seed);
    let v: number;
    if (shape === 'island') v = det * 0.85 + 0.35 - d * 0.75 + (big - 0.5) * 0.3 * Math.min(1, k - 1);
    else if (shape === 'continent') v = (big - 0.5) * 1.3 + (det - 0.5) * 0.8 + 0.36 - edge * edge * 0.5;
    else if (shape === 'archipelago') v = (det - 0.5) + (big - 0.5) * 0.9 + 0.38 - d * 0.3;
    else v = Math.pow(det * 0.75 + big * 0.35, 1.6) * 1.5;
    h[y * N + x] = Math.max(0, Math.min(1, v));
  }
  return h;
}

/** starting height for a new map: mountains keep about the same real height on every size */
export const defaultHeight = (N: number) => Math.round(22 * Math.pow(worldSize(N) / 100, 0.25));

/** Heights from an image: light = high, dark = low */
export async function heightsFromImage(src: string, N: number): Promise<Float32Array> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  // soften pixel noise
  return smoothAll(h, N, 2);
}

export function smoothAll(h: Float32Array, N: number, passes: number) {
  let a = h;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < N && yy < N) { s += a[yy * N + xx]; c++; } }
      b[y * N + x] = s / c;
    }
    a = b;
  }
  return a;
}

/* ---------- brushes (grid coordinates) ---------- */
export type Tool = 'view' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint' | 'pin' | 'object' | 'select' | 'erase';

export function applyBrush(h: Float32Array, paint: Uint8Array, N: number, cx: number, cy: number, tool: Tool, radius: number, strength: number, biome: number, flatTo: number) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(N - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(N - 1, Math.ceil(cy + radius));
  const src = tool === 'smooth' ? h.slice() : h;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (d2 > r2) continue;
    const fall = 1 - Math.sqrt(d2) / radius;
    const w = fall * fall * strength;
    const i = y * N + x;
    if (tool === 'raise') h[i] = Math.min(1, h[i] + 0.02 * w);
    else if (tool === 'lower') h[i] = Math.max(0, h[i] - 0.02 * w);
    else if (tool === 'flatten') h[i] += (flatTo - h[i]) * Math.min(1, w * 0.4);
    else if (tool === 'smooth') {
      let s = 0, c = 0;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const xx = x + k, yy = y + j; if (xx >= 0 && yy >= 0 && xx < N && yy < N) { s += src[yy * N + xx]; c++; } }
      h[i] += (s / c - h[i]) * Math.min(1, w * 0.6);
    } else if (tool === 'paint' && fall > 0.15) paint[i] = biome;
  }
}

/** Draw the map top-down (with hill shading) into a canvas — used by the 2D view and thumbnails */
export function renderTopDown(ctx: CanvasRenderingContext2D, h: Float32Array, paint: Uint8Array, N: number, sea: number, shade = true) {
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let [r, g, b] = cellColor(h[i], paint[i], sea);
    if (shade && h[i] >= sea) {
      const dx = (h[y * N + Math.min(N - 1, x + 1)] - h[y * N + Math.max(0, x - 1)]);
      const dy = (h[Math.min(N - 1, y + 1) * N + x] - h[Math.max(0, y - 1) * N + x]);
      const l = Math.max(0.55, Math.min(1.35, 1 + (-dx - dy) * 9));
      r *= l; g *= l; b *= l;
    }
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
