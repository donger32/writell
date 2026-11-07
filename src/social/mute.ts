/* Muting people: their chat messages are folded away and they don't pop up as notifications.
   Private to you (kept on this device); they aren't told. */
import { useSyncExternalStore } from 'react';

const KEY = 'writell.muted';
let muted: string[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })();
const ls = new Set<() => void>();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(muted)); } catch { /* */ } ls.forEach((l) => l()); };
export const isMuted = (id: string) => muted.includes(id);
export function setMuted(id: string, on: boolean) { muted = on ? [...new Set([...muted, id])] : muted.filter((x) => x !== id); save(); }
export const useMuted = () => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => muted, () => muted);
