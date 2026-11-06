import { useSyncExternalStore } from 'react';
import { db, type DayActivity } from './db';

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

/** Words added per day (all projects or one) */
export async function dailyTotals(projectId?: string): Promise<Map<string, number>> {
  const rows: DayActivity[] = projectId ? await db.activity.where('projectId').equals(projectId).toArray() : await db.activity.toArray();
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + r.wordsAdded);
  return m;
}

export function sumRange(m: Map<string, number>, from: Date, to = new Date()) {
  let total = 0;
  const d = new Date(from); d.setHours(12, 0, 0, 0);
  const end = new Date(to); end.setHours(12, 0, 0, 0);
  while (d <= end) { total += m.get(dayKey(d)) ?? 0; d.setDate(d.getDate() + 1); }
  return total;
}

export const startOfWeek = () => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); d.setHours(12, 0, 0, 0); return d; };
export const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(12, 0, 0, 0); return d; };

export function streaks(m: Map<string, number>, min = 1) {
  // current: consecutive days ending today (or yesterday, if nothing written yet today)
  let cur = 0;
  let i = (m.get(dayKey()) ?? 0) >= min ? 0 : 1;
  while ((m.get(dayKey(daysAgo(i))) ?? 0) >= min) { cur++; i++; }
  const days = [...m.entries()].filter(([, w]) => w >= min).map(([k]) => k).sort();
  let best = 0, run = 0, prev: Date | null = null;
  for (const k of days) {
    const d = new Date(k + 'T12:00:00');
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  return { current: cur, best: Math.max(best, cur) };
}

export const MILESTONES = [1000, 5000, 10000, 25000, 40000, 50000, 75000, 100000, 150000, 200000];

/* ---------------- Writing sprints (per device) ---------------- */

export interface Sprint { start: number; minutes: number; baseline: number; projectId: string; day?: string }
export interface SprintLog { start: number; end: number; words: number; projectId: string }
let sprint: Sprint | null = (() => { try { return JSON.parse(localStorage.getItem('inkwell.sprint') || 'null'); } catch { return null; } })();
const ls = new Set<() => void>();
const emit = () => { try { localStorage.setItem('inkwell.sprint', JSON.stringify(sprint)); } catch { /* */ } ls.forEach((l) => l()); };
export const useSprint = () => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => sprint);

export async function projectWords(projectId: string) {
  let w = 0;
  await db.scenes.where('projectId').equals(projectId).each((s) => { w += s.words; });
  return w;
}
/** Words typed today in a project (deleting never subtracts) */
export async function writtenOn(projectId: string, day = dayKey()) {
  return (await db.activity.get(`${projectId}:${day}`))?.wordsAdded ?? 0;
}
/** Words typed since the sprint began */
export async function sprintWords(s: Sprint) {
  if (!s.day) return Math.max(0, (await projectWords(s.projectId)) - s.baseline); // sprint started by an older version
  const today = dayKey();
  if (today === s.day) return (await writtenOn(s.projectId)) - s.baseline;
  return (await writtenOn(s.projectId, s.day)) - s.baseline + (await writtenOn(s.projectId, today));
}
export async function startSprint(projectId: string, minutes: number) {
  sprint = { start: Date.now(), minutes, baseline: await writtenOn(projectId), projectId, day: dayKey() };
  emit();
}
export async function stopSprint(): Promise<SprintLog | null> {
  if (!sprint) return null;
  const words = await sprintWords(sprint);
  const log: SprintLog = { start: sprint.start, end: Date.now(), words, projectId: sprint.projectId };
  try { localStorage.setItem('inkwell.sprints', JSON.stringify([...getSprintLog(), log].slice(-200))); } catch { /* */ }
  sprint = null; emit();
  return log;
}
export function getSprintLog(): SprintLog[] { try { return JSON.parse(localStorage.getItem('inkwell.sprints') || '[]'); } catch { return []; } }
