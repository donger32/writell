/* Manuscript analysis helpers (all local, no AI) */

const STOP = new Set(('a an the and or but if then so of to in on at by for with from as is was were be been being am are it its it\'s this that these those i you he she we they me him her us them my your his our their not no yes do did does done have has had having will would can could should shall may might must just than too very also there here what which who whom whose when where why how all any both each few more most other some such only own same into over under again further once up down out off about above below between through during before after while because until against s t don\'t didn\'t wasn\'t isn\'t couldn\'t wouldn\'t i\'m i\'d i\'ll you\'re she\'s he\'s they\'re we\'re that\'s one like said back').split(/\s+/));

export const tokenize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}’'-]+/gu) ?? []).map((w) => w.replace(/’/g, "'").replace(/^'+|'+$/g, '')).filter(Boolean);

export function repeatedWords(text: string, limit = 25) {
  const counts = new Map<string, number>();
  for (const w of tokenize(text)) if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function repeatedPhrases(text: string, limit = 20) {
  const counts = new Map<string, number>();
  // phrases don't cross sentence boundaries
  for (const sentence of text.split(/[.!?…\n]+/)) {
    const ws = tokenize(sentence);
    for (const n of [3, 4, 2]) for (let i = 0; i + n <= ws.length; i++) {
      const g = ws.slice(i, i + n);
      if (g.every((w) => STOP.has(w))) continue;
      if (n === 2 && (STOP.has(g[0]) || STOP.has(g[1]))) continue;
      const k = g.join(' ');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const list = [...counts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  // hide shorter phrases contained in a longer one with the same count
  return list.filter(([k, c]) => !list.some(([k2, c2]) => k2 !== k && c2 === c && k2.includes(k))).slice(0, limit);
}

/** Same word used again within `window` words */
export function echoes(text: string, window = 25) {
  const ws = tokenize(text);
  const last = new Map<string, number>();
  const hits = new Map<string, number>();
  ws.forEach((w, i) => {
    if (w.length < 4 || STOP.has(w)) return;
    const p = last.get(w);
    if (p !== undefined && i - p <= window) hits.set(w, (hits.get(w) ?? 0) + 1);
    last.set(w, i);
  });
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
}

export function adverbs(text: string) {
  const counts = new Map<string, number>();
  const notAdverbs = new Set(['only', 'family', 'early', 'lonely', 'ugly', 'holy', 'reply', 'apply', 'supply', 'belly', 'jelly', 'lily', 'silly', 'rely', 'italy', 'july', 'fly', 'ally', 'friendly', 'likely', 'daily', 'lovely', 'elderly', 'curly', 'chilly', 'bully', 'rally', 'sally', 'emily', 'kelly', 'molly', 'polly', 'billy', 'hilly', 'oily', 'woolly', 'costly', 'deadly', 'lively', 'orderly', 'unlikely']);
  for (const w of tokenize(text)) if (w.length > 4 && w.endsWith('ly') && !notAdverbs.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Capitalised words that are one or two letters away from a known character name */
export function nameInconsistencies(text: string, names: string[]) {
  const known = new Set<string>();
  for (const n of names) for (const part of n.split(/[\s,]+/)) if (part.length >= 3) known.add(part);
  const caps = new Map<string, number>();
  for (const m of text.matchAll(/(?<![\p{L}])(\p{Lu}[\p{Ll}’'-]{2,})/gu)) caps.set(m[1], (caps.get(m[1]) ?? 0) + 1);
  const out: { found: string; count: number; probably: string }[] = [];
  for (const [w, c] of caps) {
    if (known.has(w) || STOP.has(w.toLowerCase())) continue;
    for (const k of known) {
      const dist = lev(w.toLowerCase(), k.toLowerCase());
      if (dist > 0 && dist <= (k.length > 6 ? 2 : 1) && w.toLowerCase().replace(/'s$/, '') !== k.toLowerCase()) { out.push({ found: w, count: c, probably: k }); break; }
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

export const DEFAULT_CHECKLIST = [
  'Opening line hooks the reader',
  'Every scene has a goal, conflict and outcome',
  'POV is consistent within each scene',
  'Character names and details match their profiles',
  'Timeline and dates are consistent',
  'Dialogue tags are minimal and clear',
  'Cut repeated words and filler (just, really, very, that)',
  'Chapter ends with a reason to keep reading',
  'Read aloud once',
];
