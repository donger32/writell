/* Announcements, ban notice, and the fun effects admins can send (confetti, snow, hearts, shouts…) */
import { useEffect, useRef, useState } from 'react';
import { Megaphone, PartyPopper, TriangleAlert, Heart, X, Ban } from 'lucide-react';
import { onFx, useAnnouncements, type Fx } from '../social/effects';
import { getProfiles, isBanned, useSocial, type Profile } from '../social/api';
import { Avatar } from './story/common';
import { UserName, displayName } from './UserName';
import { toast } from './ui';

const DKEY = 'writell.dismissedAnnouncements';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Announcements() {
  const anns = useAnnouncements();
  const social = useSocial();
  const [dismissed, setDismissed] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem(DKEY) || '[]'); } catch { return []; } });
  const partied = useRef(new Set<number>());
  const show = anns.filter((a) => !dismissed.includes(a.id)).slice(0, 2);
  useEffect(() => {
    for (const a of show) if (a.style === 'party' && !partied.current.has(a.id)) { partied.current.add(a.id); burst('confetti'); }
  }, [show.map((a) => a.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = (id: number) => { const n = [...dismissed, id].slice(-50); setDismissed(n); try { localStorage.setItem(DKEY, JSON.stringify(n)); } catch { /* */ } };
  const me = social.me;
  return (
    <>
      {isBanned(me) && (
        <div className="ann-bar warning" role="status"><Ban size={15} />
          <span className="grow">You’re banned from chatting and friend requests until <b>{new Date(me!.banned_until!).toLocaleString()}</b>{me!.ban_reason ? `: ${me!.ban_reason}` : ''}. Your own writing and sync still work.</span>
        </div>
      )}
      {show.map((a) => {
        const I = a.style === 'party' ? PartyPopper : a.style === 'warning' ? TriangleAlert : a.style === 'love' ? Heart : Megaphone;
        return (
          <div key={a.id} className={'ann-bar ' + a.style} role="status">
            <I size={15} /><span className="grow">{a.text}</span>
            <button className="icon-btn sm" aria-label="Dismiss" onClick={() => close(a.id)}><X size={14} /></button>
          </div>
        );
      })}
    </>
  );
}

/* ---------------- one-off effects ---------------- */
let burst: (kind: 'confetti' | 'snow' | 'hearts') => void = () => {};

export function EffectsLayer() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shout, setShout] = useState<{ text: string; from: Profile | null } | null>(null);
  const [spot, setSpot] = useState<Profile | null>(null);
  const [hearts, setHearts] = useState<number[]>([]);

  useEffect(() => {
    type P = { x: number; y: number; vx: number; vy: number; r: number; c: string; rot: number; vr: number; snow: boolean };
    let parts: P[] = []; let raf = 0; let until = 0;
    const COLORS = ['#ff5f6d', '#ffc371', '#47e891', '#4facfe', '#a66cff', '#f472b6', '#ffd23f'];
    const frame = () => {
      const c = canvas.current; if (!c) return;
      const ctx = c.getContext('2d')!; const w = (c.width = innerWidth), h = (c.height = innerHeight);
      ctx.clearRect(0, 0, w, h);
      const done = Date.now() > until;
      parts = parts.filter((p) => p.y < h + 30 && !(done && p.y < -10));
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.snow) { p.vx = Math.sin((p.y + p.r * 50) / 60) * 0.6; } else { p.vy += 0.12; p.vx *= 0.99; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
        if (p.snow) { ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      }
      if (parts.length) raf = requestAnimationFrame(frame); else { ctx.clearRect(0, 0, w, h); raf = 0; }
    };
    burst = (kind) => {
      if (reduced()) { toast(kind === 'snow' ? '❄️ It’s snowing!' : kind === 'hearts' ? '💖' : '🎉 Confetti!'); return; }
      if (kind === 'hearts') { const ids = Array.from({ length: 24 }, (_, i) => Date.now() + i); setHearts((h) => [...h, ...ids]); window.setTimeout(() => setHearts((h) => h.filter((x) => !ids.includes(x))), 5200); return; }
      const w = innerWidth;
      if (kind === 'confetti') {
        until = Date.now() + 600;
        for (let i = 0; i < 220; i++) { const left = i % 2 === 0; parts.push({ x: left ? 0 : w, y: innerHeight * 0.7, vx: (left ? 1 : -1) * (4 + Math.random() * 9), vy: -(8 + Math.random() * 10), r: 4 + Math.random() * 4, c: COLORS[i % COLORS.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, snow: false }); }
      } else {
        until = Date.now() + 7000;
        const add = () => { if (Date.now() > until) return; for (let i = 0; i < 6; i++) parts.push({ x: Math.random() * w, y: -10, vx: 0, vy: 0.8 + Math.random() * 1.6, r: 1.5 + Math.random() * 3, c: '#ffffff', rot: 0, vr: 0, snow: true }); window.setTimeout(add, 120); };
        add();
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const off = onFx(async (fx: Fx) => {
      if (fx.kind === 'confetti' || fx.kind === 'snow' || fx.kind === 'hearts') burst(fx.kind);
      else if (fx.kind === 'shake') { if (reduced()) toast('📳 Bzzz!'); else { document.body.classList.remove('fx-shake'); void document.body.offsetWidth; document.body.classList.add('fx-shake'); window.setTimeout(() => document.body.classList.remove('fx-shake'), 800); } }
      else if (fx.kind === 'shout') { const from = (await getProfiles([fx.created_by])).get(fx.created_by) ?? null; setShout({ text: fx.text ?? '', from }); }
      else if (fx.kind === 'spotlight' && fx.text) { const p = (await getProfiles([fx.text])).get(fx.text); if (p) { setSpot(p); burst('confetti'); } }
    });
    return () => { off(); cancelAnimationFrame(raf); burst = () => {}; };
  }, []);
  useEffect(() => { if (!shout) return; const t = window.setTimeout(() => setShout(null), 7000); return () => window.clearTimeout(t); }, [shout]);
  useEffect(() => { if (!spot) return; const t = window.setTimeout(() => setSpot(null), 8000); return () => window.clearTimeout(t); }, [spot]);

  return (
    <>
      <canvas ref={canvas} className="fx-canvas" aria-hidden="true" />
      {hearts.length > 0 && <div className="fx-hearts" aria-hidden="true">{hearts.map((h, i) => <span key={h} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 8) * 0.25}s`, fontSize: `${18 + (i % 4) * 8}px` }}>{['💖', '💗', '💕', '❤️'][i % 4]}</span>)}</div>}
      {shout && (
        <div className="fx-shout" role="alert" onClick={() => setShout(null)}>
          <Megaphone size={22} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="small">{shout.from ? <>{displayName(shout.from)} shouts:</> : 'Announcement:'}</span>
            <strong>{shout.text}</strong>
          </div>
        </div>
      )}
      {spot && (
        <div className="fx-spot" role="status" onClick={() => setSpot(null)}>
          <span className="fx-spot-kicker">🌟 Spotlight</span>
          <Avatar name={displayName(spot)} image={spot.avatar ?? undefined} size={72} />
          <strong className="fx-spot-name"><UserName p={spot} /></strong>
          <span className="muted">@{spot.username}</span>
        </div>
      )}
    </>
  );
}
