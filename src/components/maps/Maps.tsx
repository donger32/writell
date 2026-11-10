import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import {
  Move, Plus, Pencil, Trash2, Box, Square, Hand, ArrowUp, ArrowDown, Waves, Minus, Paintbrush, MapPin, Wand2, ImagePlus, Download, X, ExternalLink, Undo2, Home, MousePointer2, Eraser, SlidersHorizontal, Maximize, RotateCw, Copy,
} from 'lucide-react';
import { db, uid, type Entity } from '../../db';
import { autoColor, createEntity, deleteEntity, updateEntity, pickImage } from '../../entities';
import { toastTrashed } from '../TrashView';
import { go } from '../../nav';
import { registerFlush } from '../../saveRegistry';
import { saveBinary, safeName } from '../../util';
import {
  BIOMES, MAP_SIZES, MAX_N, METERS, OBJECTS, applyBrush, decodeHeights, decodeU8, encode, heightFields, expandMap, generate, heightsFromImage, objDef, sizeLabel, smoothAll, defaultHeight, strokePts,
  type Journey, type MapObject, type ObjKind, type Pin, type Shape, type Tool,
} from '../../mapdata';
import type { JourneyDraw, Rect } from './Terrain3D';
import { Modal, confirmDialog, openMenu, promptDialog, toast } from '../ui';
import { Picker, useProjectOptions } from '../story/common';
import { openEntity } from '../story/links';
import { Terrain3D } from './Terrain3D';
import { TimelineBox } from '../visual/TimelineBox';
import { Map2D } from './Map2D';

const N_DEFAULT = 160;
const PIN_COLORS = ['#e06c75', '#e8c547', '#5fbf8f', '#5fa8f5', '#8b7cf6', '#ffffff'];

export function MapsView({ projectId, entityId }: { projectId: string; entityId?: string }) {
  const maps = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'map']).sortBy('createdAt'), [projectId]);
  const [creating, setCreating] = useState(false);
  if (!maps) return null;
  const map = maps.find((m) => m.id === entityId) ?? maps[0];
  return (
    <div className="visual">
      <div className="visual-bar">
        <h2>Map</h2>
        {maps.length > 0 && <div className="seg">{maps.map((m) => <button key={m.id} className={m.id === map?.id ? 'on' : ''} onClick={() => go({ view: 'maps', projectId, entityId: m.id })}>{m.name}</button>)}</div>}
        <button className="btn sm" onClick={() => setCreating(true)}><Plus size={13} /> New map</button>
        {map && <>
          <button className="icon-btn" title="Rename map" onClick={async () => { const n = await promptDialog('Rename map', map.name); if (n) updateEntity(map.id, { name: n }); }}><Pencil size={14} /></button>
          <button className="icon-btn" title="Delete map" onClick={async () => { go({ view: 'maps', projectId }); toastTrashed(map.name, await deleteEntity(map.id)); }}><Trash2 size={14} /></button>
        </>}
      </div>
      {map ? <MapEditor key={map.id} map={map} /> : (
        <div className="edetail-empty"><h3>Maps</h3><p className="muted">Sculpt a 3D world or upload a drawn map, and switch between 3D and 2D at any time. Pin places from your worldbuilding onto it.</p><button className="btn primary" onClick={() => setCreating(true)}><Plus size={14} /> New map</button></div>
      )}
      {creating && <NewMapDialog projectId={projectId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewMapDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [shape, setShape] = useState<Shape | 'picture'>('island');
  const [picture, setPicture] = useState<string | null>(null);
  const [aspect, setAspect] = useState(1);
  const [raise, setRaise] = useState(false);
  const [size, setSize] = useState(N_DEFAULT);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30)); // let "Creating…" show before the work starts
    const N = size;
    let heights: Float32Array;
    if (shape === 'picture') {
      if (!picture) { setBusy(false); return; }
      heights = raise ? await heightsFromImage(picture, N) : new Float32Array(N * N).fill(0.4);
    } else heights = generate(N, shape);
    const id = await createEntity(projectId, 'map', name.trim() || (shape === 'picture' ? 'Map' : 'New world'), {
      size: N, ...heightFields(heights), paint: encode(new Uint8Array(N * N)), seaLevel: shape === 'picture' ? (raise ? 0.18 : 0) : 0.3,
      heightScale: shape === 'picture' && !raise ? 2 : defaultHeight(N),
      aspect: shape === 'picture' ? aspect : 1, image: picture ?? undefined, useImage: shape === 'picture', lowPoly: true, view: shape === 'picture' ? '2d' : '3d', pins: [], objects: [],
    });
    onClose();
    go({ view: 'maps', projectId, entityId: id });
  };
  const SHAPES: { id: Shape | 'picture'; label: string; sub: string }[] = [
    { id: 'island', label: 'Island', sub: 'One landmass surrounded by sea' }, { id: 'continent', label: 'Continent', sub: 'Large land, coasts at the edges' },
    { id: 'archipelago', label: 'Archipelago', sub: 'Scattered islands' }, { id: 'mountains', label: 'Mountain range', sub: 'Peaks and valleys' },
    { id: 'flat', label: 'Blank', sub: 'Flat land to sculpt yourself' }, { id: 'picture', label: 'From a picture', sub: 'Upload a map you drew or found' },
  ];
  return (
    <Modal title="New map" onClose={onClose}>
      <div className="pad col gap">
        <label className="sfield"><span>Name</span><input className="input" autoFocus value={name} placeholder="The Known World" onChange={(e) => setName(e.target.value)} /></label>
        <div className="tpl-grid">{SHAPES.map((s) => <button key={s.id} className={'tpl' + (shape === s.id ? ' on' : '')} onClick={() => setShape(s.id)}><strong>{s.label}</strong><span className="muted small">{s.sub}</span></button>)}</div>
        <div className="sfield"><span>Size</span>
          <div className="seg size-seg">{MAP_SIZES.map((z) => <button key={z.id} className={size === z.N ? 'on' : ''} onClick={() => setSize(z.N)} title={z.sub}>{z.label}</button>)}</div>
          <span className="muted small">{MAP_SIZES.find((z) => z.N === size)?.sub}. Bigger maps hold more land, and you can make any map bigger later.</span>
        </div>
        {shape === 'picture' && (
          <div className="col gap-s">
            <div className="row gap-s">
              <button className="btn sm" onClick={async () => {
                const d = await pickImage(2048); if (!d) return;
                const i = new Image(); i.onload = () => setAspect(i.width / i.height); i.src = d; setPicture(d);
              }}><ImagePlus size={13} /> {picture ? 'Choose another picture' : 'Choose picture'}</button>
              {picture && <img src={picture} alt="" className="map-thumb" />}
            </div>
            <label className="check small"><input type="checkbox" checked={raise} onChange={(e) => setRaise(e.target.checked)} /> Raise it into 3D now (lighter areas become higher ground). You can also do this later.</label>
          </div>
        )}
        <p className="muted small">Every map can switch between 3D and 2D at any time. Both show the same land and pins.</p>
        <div className="row end gap-s"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (shape === 'picture' && !picture)} onClick={create}>{busy ? 'Creating…' : 'Create map'}</button></div>
      </div>
    </Modal>
  );
}

const TOOLS: { id: Tool; label: string; icon: typeof Hand; key: string }[] = [
  { id: 'view', label: 'Move view', icon: Hand, key: 'V' }, { id: 'raise', label: 'Raise land', icon: ArrowUp, key: 'R' },
  { id: 'lower', label: 'Lower land', icon: ArrowDown, key: 'L' }, { id: 'smooth', label: 'Smooth', icon: Waves, key: 'S' },
  { id: 'flatten', label: 'Flatten', icon: Minus, key: 'F' }, { id: 'paint', label: 'Paint terrain', icon: Paintbrush, key: 'P' },
  { id: 'pin', label: 'Place pin', icon: MapPin, key: 'M' },
  { id: 'object', label: 'Place buildings & nature', icon: Home, key: 'B' },
  { id: 'select', label: 'Select & move things', icon: MousePointer2, key: 'E' },
  { id: 'erase', label: 'Remove things (drag over buildings, walls, trees…)', icon: Eraser, key: 'X' },
];

type Snap = { h: Float32Array; p: Uint8Array; o: MapObject[] };
const NATURE = new Set<ObjKind>(['tree', 'pine', 'rock']);
const OBJ_COLORS = ['#c9b18a', '#d8c7a0', '#a7a198', '#8f8a82', '#8c3b2e', '#4b5d7a', '#3f7d3a', '#2d5e3a', '#e06c75', '#e8c547', '#5fa8f5', '#8b7cf6'];

function MapEditor({ map }: { map: Entity }) {
  const f = map.fields;
  const N = Number(f.size ?? N_DEFAULT);
  // decoded once (not on every redraw: a giant map is megabytes of text)
  const [initial] = useState(() => ({ h: decodeHeights(f.heights as string, N * N, f.hfmt), p: decodeU8(f.paint as string, N * N) }));
  const heights = useRef<Float32Array>(initial.h);
  const paint = useRef<Uint8Array>(initial.p);
  const [objs, setObjs] = useState<MapObject[]>(() => (f.objects as MapObject[] | undefined) ?? []);
  const objsRef = useRef(objs); objsRef.current = objs;
  const undo = useRef<Snap[]>([]);
  const dirtyRect = useRef<Rect | null>(null);
  const [version, setVersion] = useState(0);
  const [tool, setTool] = useState<Tool>('view');
  const [brush, setBrush] = useState(8);
  // brush sizes go down to a few meters (things are real size now); land tools still need about one map cell
  const BMIN = 0.15;
  const effBrush = (t: Tool) => Math.max(t === 'erase' ? BMIN : 0.75, brush);
  const meters = (cells: number) => { const m = cells * 2 * (100 / 159) * METERS; return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`; };
  const [strength, setStrength] = useState(0.6);
  const [biome, setBiome] = useState(2);
  const [kind, setKind] = useState<ObjKind>('house');
  // phones: the side panel is a sheet over the bottom of the map, opened when it's needed
  const [sheet, setSheet] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [selObj, setSelObj] = useState<string | null>(null);
  useEffect(() => { if (selObj || tool === 'object') setSheet(true); }, [selObj, tool]); // the palette / editing controls live in the sheet
  const [pendingLine, setPendingState] = useState<{ u: number; v: number } | null>(null);
  // a ref too, so quick clicks in a row never see an old value
  const pendingRef = useRef(pendingLine);
  const setPendingLine = (v: { u: number; v: number } | null) => { pendingRef.current = v; setPendingState(v); };
  const [regen, setRegen] = useState(false);
  // journeys: the one being edited, and how far into the story to show them
  const [selJ, setSelJ] = useState<string | null>(null);
  const [storyPoint, setStoryPoint] = useState('');
  const flatTo = useRef(0.4);
  const dirty = useRef(false);
  const objsDirty = useRef(false);
  const snapshot = useRef<(() => string) | null>(null);
  const opts = useProjectOptions(map.projectId);

  const view = (f.view as '2d' | '3d') ?? '3d';
  const sea = Number(f.seaLevel ?? 0.3), heightScale = Number(f.heightScale ?? 22), aspect = Number(f.aspect ?? 1);
  const pins = (f.pins as Pin[]) ?? [];
  const journeys = (f.journeys as Journey[] | undefined) ?? [];
  const setJourneys = (next: Journey[]) => set({ journeys: next });
  const editJ = journeys.find((j) => j.id === selJ);
  const set = (patch: Record<string, unknown>) => updateEntity(map.id, { fields: patch });
  const maxBrush = Math.min(120, Math.round(40 * Math.max(1, N / 160)));

  // save terrain and placed things (debounced) — and before the app closes
  const saveTimer = useRef<number | undefined>(undefined);
  const saveTerrain = () => {
    const patch: Record<string, unknown> = {};
    if (dirty.current) { dirty.current = false; Object.assign(patch, { ...heightFields(heights.current), paint: encode(paint.current) }); }
    if (objsDirty.current) { objsDirty.current = false; patch.objects = objsRef.current; }
    window.clearTimeout(saveTimer.current);
    if (Object.keys(patch).length) return set(patch);
  };
  useEffect(() => { const un = registerFlush(saveTerrain); return () => { saveTerrain(); un(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const later = () => { window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(saveTerrain, 500); };
  const snap = () => { undo.current.push({ h: heights.current.slice(), p: paint.current.slice(), o: objsRef.current }); if (undo.current.length > 30) undo.current.shift(); };
  const changeObjs = (next: MapObject[]) => { objsRef.current = next; setObjs(next); objsDirty.current = true; later(); };
  const full = () => { dirtyRect.current = null; };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { if (carry) { cancelCarry(); return; } setPendingLine(null); setSelObj(null); if (tool === 'journey') setTool('view'); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selObj) { e.preventDefault(); snap(); changeObjs(objsRef.current.filter((o) => o.id !== selObj)); setSelObj(null); return; }
      if ((e.key === ',' || e.key === '.') && selObj) { snapOnce(); changeObjs(objsRef.current.map((o) => (o.id === selObj ? { ...o, rot: o.rot + (e.key === ',' ? -1 : 1) * Math.PI / 12 } : o))); return; }
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase()); if (t) { setTool(t.id); setPendingLine(null); }
      if (e.key === '[') setBrush((b) => Math.max(BMIN, b / 1.25)); if (e.key === ']') setBrush((b) => Math.min(maxBrush, b * 1.25));
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) { e.preventDefault(); doUndo(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  // the remove tool: takes away every placed thing under the brush (one Ctrl+Z brings them all back)
  const erasedThisStroke = useRef(false);
  const eraseAt = (cx: number, cy: number, first: boolean) => {
    if (first) erasedThisStroke.current = false;
    const r = effBrush('erase'), M = N - 1;
    const near = (o: MapObject) => {
      const ax = o.u * M, ay = o.v * M;
      if (o.pts) {
        const ps = strokePts(o);
        for (let i = 0; i + 1 < ps.length; i++) {
          const [px, py] = [ps[i][0] * M, ps[i][1] * M], [qx, qy] = [ps[i + 1][0] * M, ps[i + 1][1] * M], dx = qx - px, dy = qy - py, L = dx * dx + dy * dy;
          const t = L ? Math.max(0, Math.min(1, ((cx - px) * dx + (cy - py) * dy) / L)) : 0;
          if (Math.hypot(px + t * dx - cx, py + t * dy - cy) <= r) return true;
        }
        return ps.length === 1 && Math.hypot(ps[0][0] * M - cx, ps[0][1] * M - cy) <= r;
      }
      if (o.u2 === undefined) return Math.hypot(ax - cx, ay - cy) <= r;
      // walls and bridges: the closest point along the piece
      const bx = o.u2 * M, by = (o.v2 ?? o.v) * M, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / L)) : 0;
      return Math.hypot(ax + t * dx - cx, ay + t * dy - cy) <= r;
    };
    const keep = objsRef.current.filter((o) => !near(o));
    if (keep.length === objsRef.current.length) return;
    if (!erasedThisStroke.current) { snap(); erasedThisStroke.current = true; }
    if (selObj && !keep.some((o) => o.id === selObj)) setSelObj(null);
    changeObjs(keep);
  };

  // drawing a path, road, street or river: drag across the land; points are kept about a cell apart
  const drawing = useRef<string | null>(null);
  const drawAt = (cx: number, cy: number, first: boolean) => {
    const u = cx / (N - 1), v = cy / (N - 1);
    if (u < 0 || v < 0 || u > 1 || v > 1) return;
    if (first || !drawing.current) {
      snap();
      const o: MapObject = { id: uid(), kind, u, v, rot: 0, scale: 1, pts: [u, v] };
      drawing.current = o.id; changeObjs([...objsRef.current, o]); return;
    }
    const o = objsRef.current.find((x) => x.id === drawing.current); if (!o?.pts) return;
    const lu = o.pts[o.pts.length - 2], lv = o.pts[o.pts.length - 1];
    if (Math.hypot((u - lu) * (N - 1), (v - lv) * (N - 1)) < 0.8) return;
    changeObjs(objsRef.current.map((x) => (x.id === o.id ? { ...x, pts: [...o.pts!, u, v] } : x)));
  };
  const endDraw = () => {
    const id = drawing.current; drawing.current = null; if (!id) return;
    const o = objsRef.current.find((x) => x.id === id);
    // a click without dragging doesn't make a line
    if (o && (o.pts?.length ?? 0) < 4) { changeObjs(objsRef.current.filter((x) => x.id !== id)); undo.current.pop(); }
  };
  const drawLine = tool === 'object' && !!objDef(kind).stroke;

  const onStroke = (cx: number, cy: number, first: boolean) => {
    if (tool === 'erase') { eraseAt(cx, cy, first); return; }
    if (drawLine) { drawAt(cx, cy, first); return; }
    if (first) { snap(); const i = Math.round(cy) * N + Math.round(cx); flatTo.current = heights.current[i] ?? 0.4; }
    const br = effBrush(tool);
    applyBrush(heights.current, paint.current, N, cx, cy, tool, br, strength, biome, flatTo.current);
    // only the part under the brush needs redrawing
    const r = dirtyRect.current;
    if (r) { r.x0 = Math.min(r.x0, cx - br - 1); r.y0 = Math.min(r.y0, cy - br - 1); r.x1 = Math.max(r.x1, cx + br + 1); r.y1 = Math.max(r.y1, cy + br + 1); }
    dirty.current = true; setVersion((v) => v + 1);
  };
  const onStrokeEnd = () => { if (drawLine) { endDraw(); later(); return; } if (tool !== 'erase') later(); };
  const doUndo = () => {
    const u = undo.current.pop(); if (!u) return;
    heights.current = u.h; paint.current = u.p; dirty.current = true;
    objsRef.current = u.o; setObjs(u.o); objsDirty.current = true;
    full(); setVersion((v) => v + 1); later();
  };

  const placePin = async (u: number, v: number) => {
    const label = await promptDialog('Pin name', '', 'Place pin');
    if (label === null) return;
    const pin: Pin = { id: uid(), u, v, label, color: PIN_COLORS[pins.length % PIN_COLORS.length] };
    await set({ pins: [...pins, pin] }); setSel(pin.id);
  };
  const updatePin = (id: string, patch: Partial<Pin>) => set({ pins: pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const selPin = pins.find((p) => p.id === sel);

  // placing things: one click for buildings and nature, two clicks (start, end) for walls and bridges
  const placeObject = (u: number, v: number) => {
    if (u < 0 || v < 0 || u > 1 || v > 1) return;
    if (tool === 'journey') {
      if (!editJ) return;
      const prev = editJ.stops[editJ.stops.length - 1];
      setJourneys(journeys.map((j) => (j.id === editJ.id ? { ...j, stops: [...j.stops, { id: uid(), u, v, ...(prev?.sceneId ? { sceneId: prev.sceneId } : {}) }] } : j)));
      return;
    }
    const def = objDef(kind);
    if (def.line) {
      const start = pendingRef.current;
      if (!start) { setPendingLine({ u, v }); return; }
      snap();
      const o: MapObject = { id: uid(), kind, u: start.u, v: start.v, u2: u, v2: v, rot: 0, scale: 1 };
      changeObjs([...objsRef.current, o]);
      setPendingLine(kind === 'wall' ? { u, v } : null); // walls keep going from where the last one ended (Esc stops)
      return;
    }
    snap();
    const nature = NATURE.has(kind);
    const o: MapObject = { id: uid(), kind, u, v, rot: nature ? Math.random() * Math.PI * 2 : 0, scale: nature ? 0.8 + Math.random() * 0.45 : 1 };
    changeObjs([...objsRef.current, o]);
  };
  const moveStart = useRef(false);
  const moveObject = (id: string, du: number, dv: number) => {
    if (!moveStart.current) { snap(); moveStart.current = true; }
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    changeObjs(objsRef.current.map((o) => (o.id !== id ? o : { ...o, u: clamp(o.u + du), v: clamp(o.v + dv), ...(o.u2 !== undefined ? { u2: clamp(o.u2 + du), v2: clamp((o.v2 ?? o.v) + dv) } : {}), ...(o.pts ? { pts: o.pts.map((x, i) => clamp(x + (i % 2 ? dv : du))) } : {}) })));
  };
  const endMove = () => { moveStart.current = false; later(); };
  // carrying a thing picked with "Move" from the right-click menu: it follows the mouse until you click
  const [carry, setCarry] = useState<string | null>(null);
  const carryStartLen = useRef(0);
  const endCarry = () => { setCarry(null); endMove(); };
  const cancelCarry = () => { if (moveStart.current && undo.current.length > carryStartLen.current) doUndo(); moveStart.current = false; setCarry(null); };
  const copyThing = (o: MapObject) => { snap(); const c = { ...o, id: uid(), u: Math.min(1, o.u + 0.004), v: Math.min(1, o.v + 0.004), ...(o.u2 !== undefined ? { u2: Math.min(1, o.u2 + 0.004), v2: Math.min(1, (o.v2 ?? o.v) + 0.004) } : {}), ...(o.pts ? { pts: o.pts.map((x) => Math.min(1, x + 0.004)) } : {}) }; changeObjs([...objsRef.current, c]); return c; };
  const thingMenu = (id: string, x: number, y: number) => {
    const o = objsRef.current.find((t) => t.id === id); if (!o) return;
    const name = objDef(o.kind).label;
    openMenu({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }, [
      { label: `Move ${name.toLowerCase()}`, icon: <Move size={14} />, hint: 'click to put it down', onClick: () => { carryStartLen.current = undo.current.length; moveStart.current = false; setSelObj(id); setCarry(id); } },
      { label: objDef(o.kind).stroke ? 'Width & color…' : 'Size, color & turn…', icon: <SlidersHorizontal size={14} />, onClick: () => { setSelObj(id); setSheet(true); } },
      { label: 'Copy', icon: <Copy size={14} />, onClick: () => { const c = copyThing(o); setSelObj(c.id); } },
      { divider: true, label: '', onClick: () => {} },
      { label: `Remove ${name.toLowerCase()}`, icon: <Trash2 size={14} />, danger: true, onClick: () => { snap(); changeObjs(objsRef.current.filter((t) => t.id !== id)); if (selObj === id) setSelObj(null); } },
    ]);
  };
  const selected = objs.find((o) => o.id === selObj);
  // turning, resizing and recoloring: one undo step per burst of changes
  const lastEdit = useRef(0);
  const snapOnce = () => { const now = Date.now(); if (now - lastEdit.current > 800) snap(); lastEdit.current = now; };
  const patchSel = (patch: Partial<MapObject>) => { if (selected) snapOnce(); if (selected) changeObjs(objsRef.current.map((o) => (o.id === selected.id ? { ...o, ...patch } : o))); };

  const sceneIdx = new Map((opts?.sceneOpts ?? []).map((o, i) => [o.id, i]));
  const pointIdx = storyPoint ? sceneIdx.get(storyPoint) ?? Infinity : Infinity;
  const journeysDraw: JourneyDraw[] = journeys.map((j) => {
    const stops: { u: number; v: number }[] = [];
    for (const st of j.stops) { if (st.sceneId && (sceneIdx.get(st.sceneId) ?? -1) > pointIdx) break; stops.push(st); }
    return { id: j.id, name: j.name, color: j.color, stops, selected: j.id === selJ };
  });

  const shared = {
    N, heights: heights.current, paint: paint.current, sea, aspect, image: f.image as string | undefined, useImage: !!f.useImage,
    version, tool, brush: effBrush(tool), pins, selectedPin: sel, onStroke, onStrokeEnd: () => { onStrokeEnd(); endMove(); }, onPlacePin: placePin, onSelectPin: (id: string) => setSel(id), snapshotRef: snapshot,
    objects: objs, selectedObject: selObj, pendingLine, onPlaceObject: placeObject, onSelectObject: (id: string | null) => setSelObj(id), onMoveObject: moveObject,
    drawLine, journeys: journeysDraw, carryId: carry, onCarryEnd: endCarry, onThingMenu: thingMenu,
  };

  const raiseFromPicture = async () => {
    if (!f.image) return;
    if (!(await confirmDialog('Raise the picture into 3D?', 'Lighter parts of the picture become higher ground. This replaces the current land shape (you can undo with Ctrl+Z).', { ok: 'Raise' }))) return;
    snap();
    heights.current = await heightsFromImage(String(f.image), N);
    dirty.current = true; full(); setVersion((v) => v + 1); await saveTerrain();
    await set({ heightScale: Math.max(heightScale, 18), view: '3d' });
  };
  const grow = async (N2: number) => {
    if (!(await confirmDialog(`Make the map ${sizeLabel(N2)}?`, `Your land stays in the middle, with ${sea > 0 ? 'open sea' : 'flat land'} around it to build on. Pins and placed things stay where they are. This can't be undone with Ctrl+Z.`, { ok: 'Make it bigger' }))) return;
    await saveTerrain();
    // the new room starts at the height of the old map's edge (usually its sea floor), so there's no visible seam
    let edge = 0; const hh = heights.current;
    for (let i = 0; i < N; i++) edge += hh[i] + hh[(N - 1) * N + i] + hh[i * N] + hh[i * N + N - 1];
    edge /= 4 * N;
    const fill = sea > 0 ? (edge < sea ? edge : Math.max(0, sea - 0.12)) : 0.32;
    const { h, p, remap } = expandMap(heights.current, paint.current, N, N2, fill);
    heights.current = h; paint.current = p; undo.current = [];
    const objects = objsRef.current.map((o) => ({ ...o, u: remap(o.u), v: remap(o.v), ...(o.u2 !== undefined ? { u2: remap(o.u2), v2: remap(o.v2 ?? o.v) } : {}) }));
    objsRef.current = objects; setObjs(objects);
    await set({ size: N2, ...heightFields(h), paint: encode(p), pins: pins.map((x) => ({ ...x, u: remap(x.u), v: remap(x.v) })), objects });
    full(); setVersion((v) => v + 1); setRegen(false);
    toast(`The map is now ${sizeLabel(N2)}`);
  };
  const groups = [...new Set(OBJECTS.map((o) => o.group))];

  return (
    <div className="map-editor">
      <div className="map-tools" role="toolbar" aria-label="Map tools">
        <div className="seg" role="group" aria-label="View">
          <button className={view === '3d' ? 'on' : ''} onClick={() => set({ view: '3d' })} title="3D view"><Box size={14} /> 3D</button>
          <button className={view === '2d' ? 'on' : ''} onClick={() => set({ view: '2d' })} title="2D view"><Square size={14} /> 2D</button>
        </div>
        <button className={'tb-btn map-sheet-btn' + (sheet ? ' on' : '')} title="Map details" aria-pressed={sheet} onClick={() => setSheet((v) => !v)}><SlidersHorizontal size={15} /></button>
        <span className="tb-sep" />
        {TOOLS.map((t) => <button key={t.id} className={'tb-btn' + (tool === t.id ? ' on' : '')} title={`${t.label} (${t.key})`} aria-pressed={tool === t.id} onClick={() => { setTool(t.id); setPendingLine(null); }}><t.icon size={15} /></button>)}
        <button className="tb-btn" title="Undo (Ctrl+Z)" onClick={doUndo}><Undo2 size={15} /></button>
        <span className="tb-sep" />
        {tool !== 'view' && tool !== 'pin' && tool !== 'object' && tool !== 'select' && <>
          <label className="mini-range" title="Brush size (across)"><span>Size <span className="muted">{meters(effBrush(tool))}</span></span>
            <input type="range" min={0} max={1000} value={Math.round((Math.log(brush / BMIN) / Math.log(maxBrush / BMIN)) * 1000)} onChange={(e) => setBrush(BMIN * Math.pow(maxBrush / BMIN, +e.target.value / 1000))} /></label>
          {tool !== 'paint' && tool !== 'erase' && <label className="mini-range"><span>Strength</span><input type="range" min={0.1} max={1.5} step={0.05} value={strength} onChange={(e) => setStrength(+e.target.value)} /></label>}
        </>}
        {tool === 'paint' && <div className="biomes">{BIOMES.map((b) => (
          <button key={b.id} className={'biome' + (biome === b.id ? ' on' : '')} title={b.id === 0 ? 'Erase paint (color by height)' : b.name} aria-label={b.name} onClick={() => setBiome(b.id)}
            style={{ background: b.id === 0 ? 'repeating-linear-gradient(45deg, #888 0 4px, #555 4px 8px)' : `rgb(${b.color.join(',')})` }} />
        ))}</div>}
        <span className="grow" />
        <span className="muted small map-size-tag" title={`${N}×${N} cells`}>{sizeLabel(N)}</span>
        <button className="btn ghost sm" title="Land & water" onClick={() => setRegen(true)}><Wand2 size={13} /><span className="tb-label"> Land &amp; water</span></button>
        <button className="btn ghost sm" title="Save a picture of this view" onClick={async () => {
          const url = snapshot.current?.(); if (!url) return;
          const bin = atob(url.split(',')[1]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          if (await saveBinary(`${safeName(map.name)} ${view}.png`, bytes, 'image/png')) toast('Map image saved');
        }}><Download size={13} /><span className="tb-label"> Image</span></button>
      </div>

      <div className="map-body">
        <div className="map-canvas">
          {view === '3d'
            ? <Terrain3D {...shared} heightScale={heightScale} lowPoly={!!f.lowPoly} dirtyRef={dirtyRect} />
            : <Map2D {...shared} heightScale={heightScale} onMovePin={(id, u, v) => updatePin(id, { u, v })} />}
          <div className="map-hint muted small">
            {carry ? 'Move the mouse to carry it · click to put it down · Esc to cancel'
              : tool === 'journey' ? (editJ ? `Click the map to add a stop to ${editJ.name}'s journey · Esc when done` : 'Pick a journey on the right')
              : drawLine ? `Drag across the land to draw a ${objDef(kind).label.toLowerCase()}`
              : tool === 'object' ? (objDef(kind).line ? (pendingLine ? `Click where the ${objDef(kind).label.toLowerCase()} ends · Esc to stop` : `Click where the ${objDef(kind).label.toLowerCase()} starts`) : `Click to place a ${objDef(kind).label.toLowerCase()}`)
              : tool === 'select' ? 'Click a thing to select it · drag to move · , and . to turn · Delete to remove · right-click a thing for more'
              : tool === 'erase' ? 'Click or drag over things to remove them · [ ] brush size · Ctrl+Z brings them back'
              : view === '3d' ? (tool === 'view' ? 'Drag to orbit · right-drag to pan · scroll to zoom' + (N > 160 ? ' · arrow keys to travel' : '') : 'Left-drag to use the tool · right-drag to orbit · [ ] brush size') : (tool === 'view' ? 'Drag to pan · scroll to zoom · drag pins to move them' : 'Left-drag to use the tool · right-drag to pan · [ ] brush size')}
          </div>
        </div>

        <aside className={'map-side' + (sheet ? ' open' : '')}>
          <div className="map-sheet-head row"><h4 className="grow">Map details</h4><button className="icon-btn sm" aria-label="Close" onClick={() => setSheet(false)}><X size={14} /></button></div>
          {selected && (
            <div className="pin-editor" key={selected.id}>
              <div className="row"><h4 className="grow">{objDef(selected.kind).label}</h4><button className="icon-btn sm" aria-label="Deselect" onClick={() => setSelObj(null)}><X size={12} /></button></div>
              {!objDef(selected.kind).line && !objDef(selected.kind).stroke && <label className="mini-range wide"><span><RotateCw size={11} /> Turn</span><input type="range" min={0} max={360} step={5} value={Math.round((((selected.rot * 180) / Math.PI) % 360 + 360) % 360)} onChange={(e) => patchSel({ rot: (+e.target.value * Math.PI) / 180 })} /></label>}
              <label className="mini-range wide"><span><Maximize size={11} /> {objDef(selected.kind).stroke ? 'Width' : 'Size'}</span><input type="range" min={0.25} max={objDef(selected.kind).stroke ? 8 : 6} step={0.05} value={selected.scale} onChange={(e) => patchSel({ scale: +e.target.value })} /></label>
              <div className="row gap-s wrap">
                <button className={'swatch none' + (!selected.color ? ' on' : '')} title="Default color" onClick={() => patchSel({ color: undefined })}><X size={11} /></button>
                {OBJ_COLORS.map((c) => <button key={c} className={'swatch' + (selected.color === c ? ' on' : '')} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => patchSel({ color: c })} />)}
                <input type="color" className="color-pick" value={selected.color ?? objDef(selected.kind).color} onChange={(e) => patchSel({ color: e.target.value })} aria-label="Any color" />
              </div>
              <div className="row gap-s">
                <button className="btn sm" onClick={() => { const c = copyThing(selected); setSelObj(c.id); }}><Copy size={13} /> Copy</button>
                <button className="btn sm" onClick={() => { carryStartLen.current = undo.current.length; moveStart.current = false; setCarry(selected.id); }}><Move size={13} /> Move</button>
                <button className="btn ghost sm danger-text" onClick={() => { snap(); changeObjs(objsRef.current.filter((o) => o.id !== selected.id)); setSelObj(null); }}><Trash2 size={13} /> Remove</button>
              </div>
            </div>
          )}
          {tool === 'object' && !selected && (
            <div className="col gap-s">
              <h4>Place</h4>
              {groups.map((g) => (
                <div key={g} className="col gap-s">
                  <span className="muted small">{g}</span>
                  <div className="obj-grid">{OBJECTS.filter((o) => o.group === g).map((o) => (
                    <button key={o.kind} className={'obj-btn' + (kind === o.kind ? ' on' : '')} onClick={() => { setKind(o.kind); setPendingLine(null); }}><span className="obj-swatch" style={{ background: o.color }} />{o.label}</button>
                  ))}</div>
                </div>
              ))}
              <p className="muted small">{objDef(kind).stroke ? 'Drag across the land to draw it; it follows the ground. Select it (E) to change its width or color.' : objDef(kind).line ? 'Click a start point, then an end point. Walls and fences keep going from where the last piece ended; press Esc to stop.' : 'Click the land to place it. Everything is about real size, so zoom in close to build a village. Use the select tool (E) to move, turn, resize or recolor things, and the remove tool (X) to take them away.'}</p>
            </div>
          )}
          <h4>Journeys</h4>
          {!journeys.length && <p className="muted small">Draw where a character travels across the map, and tie each stop to a scene to see where everyone is at any point in the story.</p>}
          {journeys.length > 0 && opts && (
            <label className="sfield"><span className="muted small">Show where everyone is at</span>
              <select className="input" value={storyPoint} onChange={(e) => setStoryPoint(e.target.value)}>
                <option value="">The end of the story</option>
                {opts.sceneOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
          <div className="col gap-s">
            {journeys.map((j) => (
              <button key={j.id} className={'pin-row' + (j.id === selJ ? ' on' : '')} onClick={() => { setSelJ(j.id); setTool('journey'); setSelObj(null); }}>
                <span className="dot" style={{ background: j.color }} /><span className="grow ellipsis">{j.name}</span><span className="muted small">{j.stops.length} stop{j.stops.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
          {opts && <Picker options={opts.characterOpts} buttonLabel="New journey" placeholder="Whose journey? Pick a character or type a name…"
            onPick={(id) => { const c = opts.byId.get(id); const j: Journey = { id: uid(), name: c?.name ?? 'Journey', characterId: id, color: String(c?.fields.color ?? autoColor(c?.name ?? '')), stops: [] }; setJourneys([...journeys, j]); setSelJ(j.id); setTool('journey'); }}
            onCreate={(n) => { const j: Journey = { id: uid(), name: n, color: PIN_COLORS[journeys.length % PIN_COLORS.length], stops: [] }; setJourneys([...journeys, j]); setSelJ(j.id); setTool('journey'); }} />}
          {editJ && opts && (
            <div className="pin-editor" key={editJ.id}>
              <div className="row"><h4 className="grow">{editJ.name}</h4><button className="icon-btn sm" aria-label="Done" onClick={() => { setSelJ(null); setTool('view'); }}><X size={12} /></button></div>
              <div className="row gap-s wrap">{[...PIN_COLORS, '#c0587e', '#7d8a52'].map((c) => <button key={c} className={'swatch' + (editJ.color === c ? ' on' : '')} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setJourneys(journeys.map((j) => (j.id === editJ.id ? { ...j, color: c } : j)))} />)}</div>
              {tool !== 'journey' && <button className="btn sm" onClick={() => setTool('journey')}><Plus size={13} /> Add stops</button>}
              {!editJ.stops.length && <p className="muted small">Click the map to add the first stop.</p>}
              <ol className="jstops">
                {editJ.stops.map((st, i) => (
                  <li key={st.id} className="row gap-s">
                    <span className="muted small jnum">{i + 1}</span>
                    <select className="input sm grow" value={st.sceneId ?? ''} aria-label={`When stop ${i + 1} happens`}
                      onChange={(e) => setJourneys(journeys.map((j) => (j.id !== editJ.id ? j : { ...j, stops: j.stops.map((x) => (x.id === st.id ? { ...x, sceneId: e.target.value || undefined } : x)) })))}>
                      <option value="">Any time</option>
                      {opts.sceneOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <button className="icon-btn sm" aria-label={`Remove stop ${i + 1}`} onClick={() => setJourneys(journeys.map((j) => (j.id !== editJ.id ? j : { ...j, stops: j.stops.filter((x) => x.id !== st.id) })))}><X size={12} /></button>
                  </li>
                ))}
              </ol>
              <button className="btn ghost sm danger-text" onClick={async () => { if (await confirmDialog(`Delete ${editJ.name}'s journey?`, 'Its stops are removed from the map.', { danger: true, ok: 'Delete' })) { setJourneys(journeys.filter((j) => j.id !== editJ.id)); setSelJ(null); setTool('view'); } }}><Trash2 size={13} /> Delete journey</button>
            </div>
          )}

          <h4 className="mt">Pins</h4>
          {!pins.length && <p className="muted small">Use the pin tool (M) and click the map. Pins show in both 2D and 3D.</p>}
          <div className="col gap-s">
            {pins.map((p) => (
              <button key={p.id} className={'pin-row' + (p.id === sel ? ' on' : '')} onClick={() => setSel(p.id)}>
                <span className="dot" style={{ background: p.color }} /><span className="grow ellipsis">{p.label || 'Pin'}</span>
                {p.entityId && <span className="muted small ellipsis">{opts?.byId.get(p.entityId)?.name}</span>}
              </button>
            ))}
          </div>
          {selPin && (
            <div className="pin-editor" key={selPin.id}>
              <div className="row"><h4 className="grow">Selected pin</h4><button className="icon-btn sm" onClick={() => setSel(null)}><X size={12} /></button></div>
              <input className="input" defaultValue={selPin.label} placeholder="Name" onBlur={(e) => updatePin(selPin.id, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              <div className="row gap-s">{PIN_COLORS.map((c) => <button key={c} className={'swatch' + (selPin.color === c ? ' on' : '')} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => updatePin(selPin.id, { color: c })} />)}</div>
              <div className="row gap-s">
                <span className="muted small grow">{selPin.entityId ? <>Linked to <strong>{opts?.byId.get(selPin.entityId)?.name ?? '(deleted)'}</strong></> : 'Not linked to a place'}</span>
                {opts && <Picker options={[...opts.worldOpts, ...opts.characterOpts]} buttonLabel={selPin.entityId ? 'Change' : 'Link'} placeholder="Place or character…"
                  onPick={(id) => updatePin(selPin.id, { entityId: id, label: selPin.label || opts.byId.get(id)?.name || '' })}
                  onCreate={async (n) => { const id = await createEntity(map.projectId, 'world', n, { category: 'Location' }); updatePin(selPin.id, { entityId: id, label: selPin.label || n }); }} />}
              </div>
              <div className="row gap-s">
                {selPin.entityId && opts?.byId.get(selPin.entityId) && <button className="btn sm" onClick={() => openEntity(opts.byId.get(selPin.entityId!)!)}><ExternalLink size={13} /> Open</button>}
                <button className="btn ghost sm danger-text" onClick={() => { set({ pins: pins.filter((p) => p.id !== selPin.id) }); setSel(null); }}><Trash2 size={13} /> Remove pin</button>
              </div>
            </div>
          )}

          <h4 className="mt">On the timeline</h4>
          <TimelineBox projectId={map.projectId} kind="map" id={map.id} name={map.name} />
          <h4 className="mt">Look</h4>
          <label className="mini-range wide"><span>Sea level</span><input type="range" min={0} max={0.9} step={0.01} value={sea} onChange={(e) => { full(); set({ seaLevel: +e.target.value }); }} /></label>
          {view === '3d' && <label className="mini-range wide"><span>Height</span><input type="range" min={2} max={200} step={1} value={heightScale} onChange={(e) => { full(); set({ heightScale: +e.target.value }); }} /></label>}
          {view === '3d' && <label className="check small"><input type="checkbox" checked={!!f.lowPoly} onChange={(e) => set({ lowPoly: e.target.checked })} /> Low-poly look</label>}
          {!!f.image && <label className="check small"><input type="checkbox" checked={!!f.useImage} onChange={(e) => set({ useImage: e.target.checked })} /> Show my picture {view === '3d' ? 'on the land' : 'instead of terrain colors'}</label>}
          <div className="col gap-s">
            <button className="btn sm" onClick={async () => { const d = await pickImage(2048); if (!d) return; const i = new Image(); i.onload = () => set({ image: d, useImage: true, aspect: i.width / i.height }); i.src = d; }}><ImagePlus size={13} /> {f.image ? 'Replace picture' : 'Add a map picture'}</button>
            {!!f.image && <button className="btn sm" onClick={raiseFromPicture}><Box size={13} /> Raise picture into 3D</button>}
          </div>
        </aside>
      </div>

      {regen && (
        <Modal title="Land & water" onClose={() => setRegen(false)}>
          <div className="pad col gap">
            <p className="muted small">Generate new land to start from (replaces the current shape; Ctrl+Z undoes it), or smooth what you have.</p>
            <div className="tpl-grid">
              {(['island', 'continent', 'archipelago', 'mountains', 'flat'] as Shape[]).map((s) => (
                <button key={s} className="tpl" onClick={() => {
                  snap();
                  heights.current = generate(N, s); if (s === 'flat') paint.current = new Uint8Array(N * N);
                  dirty.current = true; full(); setVersion((v) => v + 1); saveTerrain(); setRegen(false);
                }}><strong>{s[0].toUpperCase() + s.slice(1)}</strong></button>
              ))}
            </div>
            <div className="row gap-s">
              <button className="btn sm" onClick={() => { snap(); heights.current = smoothAll(heights.current, N, 2); dirty.current = true; full(); setVersion((v) => v + 1); saveTerrain(); }}>Smooth everything</button>
              <button className="btn sm" onClick={() => { snap(); paint.current = new Uint8Array(N * N); dirty.current = true; full(); setVersion((v) => v + 1); saveTerrain(); }}>Clear painted terrain</button>
            </div>
            <h4 className="share-h">Make the map bigger</h4>
            {N >= MAX_N ? <p className="muted small">This map is already the biggest size.</p> : <>
              <p className="muted small">Adds room around your land to keep building, without starting a new map. It’s {sizeLabel(N)} now.</p>
              <div className="row gap-s wrap">{MAP_SIZES.filter((z) => z.N > N).map((z) => <button key={z.id} className="btn sm" onClick={() => void grow(z.N)}><Maximize size={13} /> {z.label} <span className="muted small">({z.sub.toLowerCase()})</span></button>)}</div>
            </>}
          </div>
        </Modal>
      )}
    </div>
  );
}
