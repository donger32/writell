import { useEffect, useRef, useState } from 'react';
import { objDef, renderTopDown, smoothLine, strokePts, strokeWidth, worldSize, type MapObject, type Pin, type Tool } from '../../mapdata';
import type { JourneyDraw } from './Terrain3D';
import { uiZoom } from '../ui';

export interface Map2DProps {
  N: number; heights: Float32Array; paint: Uint8Array; sea: number; aspect: number;
  image?: string; useImage: boolean; version: number; tool: Tool; brush: number; pins: Pin[]; selectedPin: string | null;
  onStroke: (cx: number, cy: number, first: boolean) => void; onStrokeEnd: () => void;
  onPlacePin: (u: number, v: number) => void; onSelectPin: (id: string) => void; onMovePin: (id: string, u: number, v: number) => void;
  objects: MapObject[]; selectedObject: string | null; pendingLine: { u: number; v: number } | null;
  onPlaceObject: (u: number, v: number) => void; onSelectObject: (id: string | null) => void; onMoveObject: (id: string, du: number, dv: number) => void;
  snapshotRef?: React.MutableRefObject<(() => string) | null>;
  drawLine: boolean; journeys: JourneyDraw[]; heightScale?: number;
}

/** Top-down view of the same map: hill-shaded terrain colours, or the uploaded picture */
export function Map2D(p: Map2DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const drag = useRef<{ mode: 'pan' | 'draw' | 'pin' | 'obj'; x: number; y: number; vx: number; vy: number; pin?: string; u?: number; v?: number } | null>(null);
  const RES = Math.min(3072, Math.max(1024, p.N * 4)); // sharp enough to zoom into big maps
  const H = Math.round(RES / p.aspect);

  // bigger maps start zoomed in, showing as much land as a small map does
  const startView = () => {
    const k = Math.max(1, (p.N - 1) / 159), w = wrap.current?.clientWidth ?? 0, h = wrap.current?.clientHeight ?? 0;
    return { k, x: (w / 2) * (1 - k), y: (h / 2) * (1 - k) };
  };
  useEffect(() => { setView(startView()); }, [p.N]); // eslint-disable-line react-hooks/exhaustive-deps

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
      renderTopDown(t.getContext('2d')!, p.heights, p.paint, p.N, p.sea, true, p.heightScale ?? 22);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t, 0, 0, RES, H);
    }
  }, [p.version, p.sea, p.useImage, img, p.N, H, p.heightScale]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const z = uiZoom(); const mx = (e.clientX - r.left) / z, my = (e.clientY - r.top) / z;
    const k = Math.max(0.4, Math.min(8 * Math.max(1, p.N / 160), view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
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
        if ((p.tool === 'object' && !p.drawLine) || p.tool === 'journey') { p.onPlaceObject(u, v); return; }
        if (p.tool === 'select') {
          // the nearest thing within a few pixels
          const r = board.current!.getBoundingClientRect();
          let best: string | null = null, bd = 14;
          for (const o of p.objects) {
            if (o.pts) {
              // drawn lines: the nearest point along them
              const ps = strokePts(o);
              for (let i = 0; i + 1 < ps.length; i++) {
                const ax = ps[i][0] * r.width, ay = ps[i][1] * r.height, bx = ps[i + 1][0] * r.width, by = ps[i + 1][1] * r.height, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
                const t = L ? Math.max(0, Math.min(1, ((u * r.width - ax) * dx + (v * r.height - ay) * dy) / L)) : 0;
                const d = Math.hypot(ax + t * dx - u * r.width, ay + t * dy - v * r.height);
                if (d < bd) { bd = d; best = o.id; }
              }
              continue;
            }
            const cu = o.u2 !== undefined ? (o.u + o.u2) / 2 : o.u, cv = o.v2 !== undefined ? (o.v + (o.v2 ?? o.v)) / 2 : o.v;
            const d = Math.hypot((cu - u) * r.width, (cv - v) * r.height);
            if (d < bd) { bd = d; best = o.id; }
          }
          p.onSelectObject(best);
          if (best) drag.current = { mode: 'obj', x: e.clientX, y: e.clientY, vx: 0, vy: 0, pin: best, u, v };
          return;
        }
        drag.current = { mode: 'draw', x: 0, y: 0, vx: 0, vy: 0 };
        p.onStroke(u * (p.N - 1), v * (p.N - 1), true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const { u, v } = local(e);
        setCursor(p.tool !== 'view' && p.tool !== 'pin' && p.tool !== 'object' && p.tool !== 'select' && p.tool !== 'journey' && u >= 0 && v >= 0 && u <= 1 && v <= 1 ? { x: u, y: v } : null);
        if (!d) return;
        if (d.mode === 'pan') { const z = uiZoom(); setView((s) => ({ ...s, x: d.vx + (e.clientX - d.x) / z, y: d.vy + (e.clientY - d.y) / z })); }
        else if (d.mode === 'draw') p.onStroke(u * (p.N - 1), v * (p.N - 1), false);
        else if (d.mode === 'obj' && d.pin && d.u !== undefined && d.v !== undefined) { p.onMoveObject(d.pin, u - d.u, v - d.v); d.u = u; d.v = v; }
        else if (d.mode === 'pin' && d.pin && (Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3)) p.onMovePin(d.pin, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
      }}
      onPointerUp={() => { if (drag.current?.mode === 'draw' || drag.current?.mode === 'obj') p.onStrokeEnd(); drag.current = null; }}
      onPointerLeave={() => setCursor(null)}
      style={{ cursor: p.tool === 'view' ? 'grab' : p.tool === 'pin' || p.tool === 'object' || p.tool === 'journey' ? 'crosshair' : p.tool === 'select' ? 'pointer' : 'none' }}>
      <div className="map2d-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <div className="map2d-board" ref={board} style={{ aspectRatio: String(p.aspect), ['--a' as string]: String(p.aspect) }}>
          <canvas ref={canvas} width={RES} height={H} />
          <Things2D objects={p.objects} selected={p.selectedObject} pending={p.pendingLine} N={p.N} aspect={p.aspect} journeys={p.journeys} k={view.k} />
          {cursor && <div className="map2d-brush" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, width: `${(p.brush * 2 / (p.N - 1)) * 100}%`, aspectRatio: String(1 / p.aspect) }} />}
          {p.pins.map((pin) => (
            <button key={pin.id} data-pin={pin.id} className={'map2d-pin' + (pin.id === p.selectedPin ? ' on' : '')} style={{ left: `${pin.u * 100}%`, top: `${pin.v * 100}%`, ['--pin' as string]: pin.color, transform: `translate(-50%, -100%) scale(${1 / view.k})` }}>
              <span className="pin-dot" /><span className="pin-label">{pin.label || 'Pin'}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="row gap-s map2d-reset">
        {p.N > 160 && <button className="btn sm" onClick={() => setView(startView())}>Reset view</button>}
        <button className="btn sm" onClick={() => setView({ x: 0, y: 0, k: 1 })}>{p.N > 160 ? 'Whole map' : 'Reset view'}</button>
      </div>
    </div>
  );
}

/** Placed things seen from above, at their real size (with a small minimum so they never vanish) */
function Things2D({ objects, selected, pending, N, aspect, journeys, k: zoom }: { objects: MapObject[]; selected: string | null; pending: { u: number; v: number } | null; N: number; aspect: number; journeys: JourneyDraw[]; k: number }) {
  const VW = 1000, VH = 1000 / aspect;
  const unit = VW / (worldSize(N) * aspect); // svg units per 3D unit
  const minPx = 2.2 / zoom; // never smaller than about 2 screen pixels
  const sz = (x: number) => Math.max(minPx, x * unit);
  const toPath = (pts: [number, number][]) => smoothLine(pts, 5).map(([u, v], i) => `${i ? 'L' : 'M'}${(u * VW).toFixed(1)},${(v * VH).toFixed(1)}`).join('');
  const strokes = objects.filter((o) => o.pts);
  return (
    <svg className="map2d-things" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
      {/* rivers first, then paths and roads, then buildings on top */}
      {[...strokes.filter((o) => o.kind === 'river'), ...strokes.filter((o) => o.kind !== 'river')].map((o) => {
        const ps = strokePts(o); if (ps.length < 2) return null;
        const on = o.id === selected;
        return <path key={o.id} d={toPath(ps)} fill="none" stroke={on ? '#8b7cf6' : o.color ?? objDef(o.kind).color} strokeWidth={Math.max(minPx * 0.8, strokeWidth(o) * unit)} strokeLinecap="round" strokeLinejoin="round" opacity={o.kind === 'river' ? 0.92 : 1} />;
      })}
      {objects.map((o) => {
        if (o.pts) return null;
        const def = objDef(o.kind), c = o.color ?? def.color, on = o.id === selected;
        const x = o.u * VW, y = o.v * VH, k = o.scale * def.real;
        const stroke = on ? '#8b7cf6' : 'rgba(0,0,0,.55)', sw = on ? 2.5 : 1;
        if (o.u2 !== undefined) return <line key={o.id} x1={x} y1={y} x2={o.u2 * VW} y2={(o.v2 ?? o.v) * VH} stroke={on ? '#8b7cf6' : c} strokeWidth={sz((o.kind === 'bridge' ? 1.4 : o.kind === 'fence' ? 0.15 : 0.6) * k)} strokeLinecap="round" />;
        const rot = (-o.rot * 180) / Math.PI;
        const [w, d] = def.fp ?? [2, 2];
        if (def.round) return <circle key={o.id} cx={x} cy={y} r={sz((w / 2) * k)} fill={c} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />;
        return <rect key={o.id} x={x - sz(w * k) / 2} y={y - sz(d * k) / 2} width={sz(w * k)} height={sz(d * k)} fill={c} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" transform={`rotate(${rot} ${x} ${y})`} />;
      })}
      {journeys.map((j) => j.stops.length > 0 && (
        <g key={j.id}>
          {j.stops.length > 1 && <path d={toPath(j.stops.map((s) => [s.u, s.v]))} fill="none" stroke={j.color} strokeWidth={j.selected ? 3.5 : 2.5} strokeDasharray="7 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          {j.stops.map((s, i) => <circle key={i} cx={s.u * VW} cy={s.v * VH} r={(i === j.stops.length - 1 ? 5 : 3.2) / zoom} fill={j.color} stroke="#fff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />)}
          <text x={j.stops[j.stops.length - 1].u * VW + 8 / zoom} y={j.stops[j.stops.length - 1].v * VH - 6 / zoom} fontSize={13 / zoom} fontWeight={600} fill="#fff" stroke="rgba(0,0,0,.7)" strokeWidth={3 / zoom} paintOrder="stroke" className="map2d-jlabel">{j.name}</text>
        </g>
      ))}
      {pending && <circle cx={pending.u * VW} cy={pending.v * VH} r={6} fill="none" stroke="#8b7cf6" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
