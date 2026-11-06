import { useEffect, useRef, useState } from 'react';
import { renderTopDown, type Pin, type Tool } from '../../mapdata';

export interface Map2DProps {
  N: number; heights: Float32Array; paint: Uint8Array; sea: number; aspect: number;
  image?: string; useImage: boolean; version: number; tool: Tool; brush: number; pins: Pin[]; selectedPin: string | null;
  onStroke: (cx: number, cy: number, first: boolean) => void; onStrokeEnd: () => void;
  onPlacePin: (u: number, v: number) => void; onSelectPin: (id: string) => void; onMovePin: (id: string, u: number, v: number) => void;
  snapshotRef?: React.MutableRefObject<(() => string) | null>;
}

/** Top-down view of the same map: hill-shaded terrain colours, or the uploaded picture */
export function Map2D(p: Map2DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const drag = useRef<{ mode: 'pan' | 'draw' | 'pin'; x: number; y: number; vx: number; vy: number; pin?: string } | null>(null);
  const RES = 1024;
  const H = Math.round(RES / p.aspect);

  useEffect(() => {
    if (!p.image) { setImg(null); return; }
    const i = new Image(); i.onload = () => setImg(i); i.src = p.image;
  }, [p.image]);

  // draw
  useEffect(() => {
    const c = canvas.current!; const ctx = c.getContext('2d')!;
    if (p.useImage && img) { ctx.drawImage(img, 0, 0, RES, H); }
    else {
      const t = document.createElement('canvas'); t.width = p.N; t.height = p.N;
      renderTopDown(t.getContext('2d')!, p.heights, p.paint, p.N, p.sea);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t, 0, 0, RES, H);
    }
  }, [p.version, p.sea, p.useImage, img, p.N, H]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!p.snapshotRef) return;
    p.snapshotRef.current = () => {
      // bake the pins into the picture
      const out = document.createElement('canvas'); out.width = RES; out.height = H;
      const ctx = out.getContext('2d')!; ctx.drawImage(canvas.current!, 0, 0);
      ctx.font = '600 18px Inter, sans-serif'; ctx.textAlign = 'center';
      for (const pin of p.pins) {
        const x = pin.u * RES, y = pin.v * H;
        ctx.fillStyle = pin.color; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(pin.label, x, y - 14); ctx.fillStyle = '#fff'; ctx.fillText(pin.label, x, y - 14);
      }
      return out.toDataURL('image/png');
    };
  });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = board.current!.getBoundingClientRect();
    return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height };
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.max(0.4, Math.min(8, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
  };

  return (
    <div className="map2d" ref={wrap} onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        const pinEl = (e.target as HTMLElement).closest('[data-pin]') as HTMLElement | null;
        if (pinEl && e.button === 0) { p.onSelectPin(pinEl.dataset.pin!); drag.current = { mode: 'pin', x: e.clientX, y: e.clientY, vx: 0, vy: 0, pin: pinEl.dataset.pin }; return; }
        if (e.button !== 0 || p.tool === 'view') { drag.current = { mode: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; return; }
        const { u, v } = local(e);
        if (u < 0 || v < 0 || u > 1 || v > 1) return;
        if (p.tool === 'pin') { p.onPlacePin(u, v); return; }
        drag.current = { mode: 'draw', x: 0, y: 0, vx: 0, vy: 0 };
        p.onStroke(u * (p.N - 1), v * (p.N - 1), true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const { u, v } = local(e);
        setCursor(p.tool !== 'view' && p.tool !== 'pin' && u >= 0 && v >= 0 && u <= 1 && v <= 1 ? { x: u, y: v } : null);
        if (!d) return;
        if (d.mode === 'pan') setView((s) => ({ ...s, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        else if (d.mode === 'draw') p.onStroke(u * (p.N - 1), v * (p.N - 1), false);
        else if (d.mode === 'pin' && d.pin && (Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3)) p.onMovePin(d.pin, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
      }}
      onPointerUp={() => { if (drag.current?.mode === 'draw') p.onStrokeEnd(); drag.current = null; }}
      onPointerLeave={() => setCursor(null)}
      style={{ cursor: p.tool === 'view' ? 'grab' : p.tool === 'pin' ? 'crosshair' : 'none' }}>
      <div className="map2d-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <div className="map2d-board" ref={board} style={{ aspectRatio: String(p.aspect), ['--a' as string]: String(p.aspect) }}>
          <canvas ref={canvas} width={RES} height={H} />
          {cursor && <div className="map2d-brush" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, width: `${(p.brush * 2 / (p.N - 1)) * 100}%`, aspectRatio: String(1 / p.aspect) }} />}
          {p.pins.map((pin) => (
            <button key={pin.id} data-pin={pin.id} className={'map2d-pin' + (pin.id === p.selectedPin ? ' on' : '')} style={{ left: `${pin.u * 100}%`, top: `${pin.v * 100}%`, ['--pin' as string]: pin.color, transform: `translate(-50%, -100%) scale(${1 / view.k})` }}>
              <span className="pin-dot" /><span className="pin-label">{pin.label || 'Pin'}</span>
            </button>
          ))}
        </div>
      </div>
      <button className="btn sm map2d-reset" onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset view</button>
    </div>
  );
}
