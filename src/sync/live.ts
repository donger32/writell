/*
 * Live co-writing transport: everyone editing the same scene joins a realtime
 * channel. Edits (Yjs updates) and cursors (awareness) are encrypted with the
 * project key before they're sent, so the server only relays scrambled bytes.
 */
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { supabaseClient } from './engine';
import { decryptBytes, encryptBytes } from './crypto';
import { REMOTE } from './ydoc';

export type LiveStatus = 'connecting' | 'live' | 'offline';
export function joinLive(opts: { sceneId: string; doc: Y.Doc; awareness: Awareness; key: CryptoKey; onStatus?: (s: LiveStatus) => void }) {
  const { sceneId, doc, awareness, key } = opts;
  const ch = supabaseClient().channel('writell-s-' + sceneId, { config: { broadcast: { self: false } } });
  let joined = false, closed = false;
  const send = async (event: string, bytes: Uint8Array) => {
    if (!joined || closed) return;
    try { await ch.send({ type: 'broadcast', event, payload: { d: await encryptBytes(key, bytes) } }); } catch { /* the regular sync catches up */ }
  };
  // edits: batch keystrokes for a moment, then send
  let queue: Uint8Array[] = []; let t = 0;
  const flush = () => { if (!queue.length) return; const u = Y.mergeUpdates(queue); queue = []; void send('y', u); };
  const onUpdate = (u: Uint8Array, origin: unknown) => { if (origin === REMOTE) return; queue.push(u); window.clearTimeout(t); t = window.setTimeout(flush, 30); };
  doc.on('update', onUpdate);
  const onAware = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE) return;
    void send('aw', encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
  };
  awareness.on('update', onAware);
  const recv = (fn: (b: Uint8Array) => void) => async ({ payload }: { payload: { d?: string } }) => {
    if (!payload?.d) return;
    try { fn(await decryptBytes(key, payload.d)); } catch { /* not for us / damaged */ }
  };
  ch.on('broadcast', { event: 'y' }, recv((b) => Y.applyUpdate(doc, b, REMOTE)));
  ch.on('broadcast', { event: 'aw' }, recv((b) => applyAwarenessUpdate(awareness, b, REMOTE)));
  // someone joined: send them what they're missing, and your cursor
  ch.on('broadcast', { event: 'hi' }, recv((sv) => { void send('y', Y.encodeStateAsUpdate(doc, sv)); void send('aw', encodeAwarenessUpdate(awareness, [doc.clientID])); }));
  opts.onStatus?.('connecting');
  ch.subscribe((s: string) => {
    if (closed) return;
    if (s === 'SUBSCRIBED') {
      joined = true; opts.onStatus?.('live');
      void send('hi', Y.encodeStateVector(doc));
      void send('aw', encodeAwarenessUpdate(awareness, [doc.clientID]));
    } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { joined = false; opts.onStatus?.('offline'); }
  });
  return () => {
    flush();
    removeAwarenessStates(awareness, [doc.clientID], 'leave');
    void send('aw', encodeAwarenessUpdate(awareness, [doc.clientID]));
    closed = true;
    doc.off('update', onUpdate); awareness.off('update', onAware);
    window.setTimeout(() => { void supabaseClient().removeChannel(ch); }, 150);
  };
}
export { Awareness };
