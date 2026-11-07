/*
 * Things admins send to everyone's screen: announcements (a banner) and
 * one-off effects (confetti, snow, a shout…). Stored in the database (only staff
 * can add them); a realtime nudge makes them show up straight away, and a
 * regular check catches anything missed.
 */
import { useSyncExternalStore } from 'react';
import { currentUserId, getSyncStatus, supabaseClient as sb } from '../sync/engine';
import type { AnnStyle } from './admin';

export interface Fx { id: number; kind: string; target: string | null; text: string | null; created_by: string; created_at: string }
export interface Ann { id: number; text: string; style: AnnStyle; created_at: string; expires_at: string | null }

let anns: Ann[] = [];
const als = new Set<() => void>();
export const useAnnouncements = () => useSyncExternalStore((l) => { als.add(l); return () => { als.delete(l); }; }, () => anns, () => anns);

const fxListeners = new Set<(fx: Fx) => void>();
export function onFx(f: (fx: Fx) => void) { fxListeners.add(f); return () => { fxListeners.delete(f); }; }
/** Show an effect here too (for the person who sent it) */
export const playLocal = (fx: Fx) => fxListeners.forEach((f) => f(fx));

let lastFx = -1;
let busy = false;
async function check() {
  const ph = getSyncStatus().phase;
  if (!currentUserId() || ph === 'signed-out' || ph === 'needs-recovery' || busy) return;
  busy = true;
  try {
    const a = await sb().from('writell_announcements').select('id,text,style,created_at,expires_at').order('id', { ascending: false }).limit(5);
    if (!a.error) {
      const n = Date.now();
      const next = ((a.data ?? []) as Ann[]).filter((x) => !x.expires_at || Date.parse(x.expires_at) > n);
      if (JSON.stringify(next) !== JSON.stringify(anns)) { anns = next; als.forEach((l) => l()); }
    }
    if (lastFx < 0) {
      // first look: start after what's already there (don't replay old effects)
      const r = await sb().from('writell_effects').select('id').order('id', { ascending: false }).limit(1);
      if (!r.error) lastFx = Number((r.data as { id: number }[])[0]?.id ?? 0);
    } else {
      const r = await sb().from('writell_effects').select('id,kind,target,text,created_by,created_at').gt('id', lastFx).order('id', { ascending: true }).limit(20);
      if (!r.error) for (const fx of (r.data ?? []) as Fx[]) {
        lastFx = Math.max(lastFx, Number(fx.id));
        if (fx.created_by === currentUserId()) continue; // the sender already saw it
        if (Date.now() - Date.parse(fx.created_at) > 3 * 60_000) continue;
        fxListeners.forEach((f) => f(fx));
      }
    }
  } finally { busy = false; }
}

let channel: ReturnType<ReturnType<typeof sb>['channel']> | null = null;
/** Tell everyone's Writell to look now */
export function notifyFx() { try { void channel?.send({ type: 'broadcast', event: 'fx', payload: {} }); } catch { /* */ } void check(); }

let started = false;
export function startEffects() {
  if (started) return; started = true;
  const join = () => {
    if (channel || !currentUserId()) return;
    try { channel = sb().channel('writell-global', { config: { broadcast: { self: false } } }); channel.on('broadcast', { event: 'fx' }, () => { void check(); }); channel.subscribe(); } catch { channel = null; }
  };
  window.setTimeout(() => { join(); void check(); }, 2500);
  window.setInterval(() => { join(); if (document.visibilityState === 'visible') void check(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { join(); void check(); } });
}
