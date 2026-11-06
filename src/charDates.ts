/*
 * Characters have one free-form Birthday field ("23/12/1324", "Spring of 1324",
 * "Year 45", "300 BC") and a Death year. Timelines read the year out of them.
 */
import type { Entity } from './db';

const BC = /\b(BC|BCE|B\.C\.)/i;
/** Where the year sits in a free-form date: the last number with 3+ digits, else the last number */
function yearMatch(t: string) {
  const nums = [...t.matchAll(/(?<![\p{L}\p{N}-])-\d+|\d+/gu)];
  if (!nums.length) return undefined;
  const long = nums.filter((n) => n[0].replace('-', '').length >= 3);
  return long.length ? long[long.length - 1] : nums[nums.length - 1];
}
/** The year in a free-form date. "BC/BCE" makes it negative. */
export function yearFrom(v: unknown): number {
  const t = String(v ?? '').trim();
  const m = t ? yearMatch(t) : undefined;
  if (!m) return NaN;
  let y = Number(m[0]);
  if (BC.test(t) && y > 0) y = -y;
  return y;
}
/** The same date text with its year swapped ("23/12/1324" → "23/12/1330"); plain year when there was none */
export function withYear(v: unknown, year: number): string {
  const t = String(v ?? '').trim();
  const m = t ? yearMatch(t) : undefined;
  if (!m) return String(year);
  const bc = BC.test(t);
  const shown = bc ? String(Math.abs(year)) : String(year);
  const out = t.slice(0, m.index) + shown + t.slice(m.index! + m[0].length);
  return bc && year > 0 ? out.replace(BC, '').trim() : out;
}

/** Birth year: from the Birthday field (older projects: the old "birth year" field) */
export const birthYearOf = (c: Entity) => { const y = yearFrom(c.fields.birthday); return Number.isFinite(y) ? y : yearFrom(c.fields.birthYear); };
export const deathYearOf = (c: Entity) => yearFrom(c.fields.deathYear);

/** "1324 – 1390" / "b. 1324" / "" */
export function lifespan(c: Entity) {
  const b = birthYearOf(c), d = deathYearOf(c);
  if (Number.isFinite(b) && Number.isFinite(d)) return `${b} – ${d}`;
  if (Number.isFinite(b)) return `b. ${b}`;
  if (Number.isFinite(d)) return `d. ${d}`;
  return '';
}
