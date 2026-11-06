/*
 * Map data shared by the 2D and 3D views.
 *
 * map entity: kind 'map', fields {
 *   size: N (grid is N×N), heights: base64 Float32Array (0..1), paint: base64 Uint8Array (biome per cell, 0 = automatic),
 *   seaLevel: 0..1, heightScale: number, image?: dataURL, useImage: boolean (show picture instead of biome colours),
 *   pins: Pin[] (u,v in 0..1, same in both views), view: '2d' | '3d', lowPoly: boolean
 * }
 */

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
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

function valueNoise(N: number, seed: number) {
  const r = rng(seed);
  const G = 257; const grid = new Float32Array(G * G).map(() => r());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const g = (a: number, b: number) => grid[((b % G) + G) % G * G + ((a % G) + G) % G];
    const top = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * xf;
    const bot = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * xf;
    void N;
    return top + (bot - top) * yf;
  };
}

export type Shape = 'island' | 'archipelago' | 'continent' | 'mountains' | 'flat';

export function generate(N: number, shape: Shape, seed = Math.floor(Math.random() * 1e9)): Float32Array {
  const h = new Float32Array(N * N);
  if (shape === 'flat') return h.fill(0.32);
  const noise = valueNoise(N, seed);
  const freq = shape === 'archipelago' ? 7 : shape === 'mountains' ? 4 : 3;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, amp = 1, f = freq / N, tot = 0;
    for (let o = 0; o < 5; o++) { v += noise(x * f + o * 31, y * f + o * 17) * amp; tot += amp; amp *= 0.5; f *= 2; }
    v /= tot;
    const dx = x / (N - 1) - 0.5, dy = y / (N - 1) - 0.5, d = Math.sqrt(dx * dx + dy * dy) * 2;
    if (shape === 'island') v = v * 0.85 + 0.35 - d * 0.75;
    else if (shape === 'archipelago') v = v * 1.1 - d * 0.35;
    else if (shape === 'continent') v = v * 0.9 + 0.2 - Math.max(0, d - 0.6) * 0.9;
    else if (shape === 'mountains') v = Math.pow(v, 1.6) * 1.5;
    h[y * N + x] = Math.max(0, Math.min(1, v));
  }
  return h;
}

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
export type Tool = 'view' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint' | 'pin';

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
