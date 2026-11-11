/*
 * Small pointer effects (Settings → Appearance): a ripple where you click, a soft trail, or sparkles.
 * They're drawn above everything, never catch clicks, and stay off for people who prefer less motion.
 */
import { useEffect } from 'react';
import { useSettings } from '../settings';

export function CursorFx() {
  const { cursorFx } = useSettings();
  useEffect(() => {
    if (!cursorFx || cursorFx === 'none') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div'); layer.className = 'cfx-layer'; document.body.appendChild(layer);
    const z = () => parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
    const spawn = (cls: string, x: number, y: number, life: number, style?: Partial<CSSStyleDeclaration>) => {
      const el = document.createElement('span'); el.className = cls;
      const k = z(); el.style.left = x / k + 'px'; el.style.top = y / k + 'px';
      if (style) Object.assign(el.style, style);
      layer.appendChild(el); window.setTimeout(() => el.remove(), life);
    };
    let last = 0, lx = 0, ly = 0;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && cursorFx === 'trail') return;
      if (cursorFx === 'ripple' || cursorFx === 'trail') spawn('cfx-ripple', e.clientX, e.clientY, 520);
      if (cursorFx === 'sparkle') for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6, d = 14 + Math.random() * 16;
        spawn('cfx-spark', e.clientX, e.clientY, 600, { ['--dx' as string]: `${Math.cos(a) * d}px`, ['--dy' as string]: `${Math.sin(a) * d}px` } as Partial<CSSStyleDeclaration>);
      }
    };
    const move = (e: PointerEvent) => {
      if (cursorFx !== 'trail' || e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - last < 18 || Math.hypot(e.clientX - lx, e.clientY - ly) < 6) return;
      last = now; lx = e.clientX; ly = e.clientY;
      if (layer.childElementCount < 40) spawn('cfx-trail', e.clientX, e.clientY, 420);
    };
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); layer.remove(); };
  }, [cursorFx]);
  return null;
}
