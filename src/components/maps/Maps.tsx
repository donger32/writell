import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import {
  Plus, Pencil, Trash2, Box, Square, Hand, ArrowUp, ArrowDown, Waves, Minus, Paintbrush, MapPin, Wand2, ImagePlus, Download, X, ExternalLink, Undo2,
} from 'lucide-react';
import { db, uid, type Entity } from '../../db';
import { createEntity, deleteEntity, updateEntity, pickImage } from '../../entities';
import { toastTrashed } from '../TrashView';
import { go } from '../../nav';
import { registerFlush } from '../../saveRegistry';
import { saveBinary, safeName } from '../../util';
import {
  BIOMES, applyBrush, decodeF32, decodeU8, encode, generate, heightsFromImage, smoothAll, type Pin, type Shape, type Tool,
} from '../../mapdata';
import { Modal, confirmDialog, promptDialog, toast } from '../ui';
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
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const N = N_DEFAULT;
    let heights: Float32Array;
    if (shape === 'picture') {
      if (!picture) { setBusy(false); return; }
      heights = raise ? await heightsFromImage(picture, N) : new Float32Array(N * N).fill(0.4);
    } else heights = generate(N, shape);
    const id = await createEntity(projectId, 'map', name.trim() || (shape === 'picture' ? 'Map' : 'New world'), {
      size: N, heights: encode(heights), paint: encode(new Uint8Array(N * N)), seaLevel: shape === 'picture' ? (raise ? 0.18 : 0) : 0.3, heightScale: shape === 'picture' && !raise ? 2 : 22,
      aspect: shape === 'picture' ? aspect : 1, image: picture ?? undefined, useImage: shape === 'picture', lowPoly: false, view: shape === 'picture' ? '2d' : '3d', pins: [],
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
        <div className="row end gap-s"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (shape === 'picture' && !picture)} onClick={create}>Create map</button></div>
      </div>
    </Modal>
  );
}

const TOOLS: { id: Tool; label: string; icon: typeof Hand; key: string }[] = [
  { id: 'view', label: 'Move view', icon: Hand, key: 'V' }, { id: 'raise', label: 'Raise land', icon: ArrowUp, key: 'R' },
  { id: 'lower', label: 'Lower land', icon: ArrowDown, key: 'L' }, { id: 'smooth', label: 'Smooth', icon: Waves, key: 'S' },
  { id: 'flatten', label: 'Flatten', icon: Minus, key: 'F' }, { id: 'paint', label: 'Paint terrain', icon: Paintbrush, key: 'P' },
  { id: 'pin', label: 'Place pin', icon: MapPin, key: 'M' },
];

function MapEditor({ map }: { map: Entity }) {
  const f = map.fields;
  const N = Number(f.size ?? N_DEFAULT);
  const heights = useRef<Float32Array>(decodeF32(f.heights as string, N * N));
  const paint = useRef<Uint8Array>(decodeU8(f.paint as string, N * N));
  const undo = useRef<{ h: Float32Array; p: Uint8Array }[]>([]);
  const [version, setVersion] = useState(0);
  const [tool, setTool] = useState<Tool>('view');
  const [brush, setBrush] = useState(8);
  const [strength, setStrength] = useState(0.6);
  const [biome, setBiome] = useState(2);
  const [sel, setSel] = useState<string | null>(null);
  const [regen, setRegen] = useState(false);
  const flatTo = useRef(0.4);
  const dirty = useRef(false);
  const snapshot = useRef<(() => string) | null>(null);
  const opts = useProjectOptions(map.projectId);

  const view = (f.view as '2d' | '3d') ?? '3d';
  const sea = Number(f.seaLevel ?? 0.3), heightScale = Number(f.heightScale ?? 22), aspect = Number(f.aspect ?? 1);
  const pins = (f.pins as Pin[]) ?? [];
  const set = (patch: Record<string, unknown>) => updateEntity(map.id, { fields: patch });

  // save terrain (debounced) — and before the app closes
  const saveTimer = useRef<number | undefined>(undefined);
  const saveTerrain = () => { if (!dirty.current) return; dirty.current = false; window.clearTimeout(saveTimer.current); return set({ heights: encode(heights.current), paint: encode(paint.current) }); };
  useEffect(() => { const un = registerFlush(saveTerrain); return () => { saveTerrain(); un(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase()); if (t) setTool(t.id);
      if (e.key === '[') setBrush((b) => Math.max(2, b - 2)); if (e.key === ']') setBrush((b) => Math.min(40, b + 2));
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) { e.preventDefault(); doUndo(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const onStroke = (cx: number, cy: number, first: boolean) => {
    if (first) {
      undo.current.push({ h: heights.current.slice(), p: paint.current.slice() }); if (undo.current.length > 30) undo.current.shift();
      const i = Math.round(cy) * N + Math.round(cx); flatTo.current = heights.current[i] ?? 0.4;
    }
    applyBrush(heights.current, paint.current, N, cx, cy, tool, brush, strength, biome, flatTo.current);
    dirty.current = true; setVersion((v) => v + 1);
  };
  const onStrokeEnd = () => { window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(saveTerrain, 400); };
  const doUndo = () => { const u = undo.current.pop(); if (!u) return; heights.current = u.h; paint.current = u.p; dirty.current = true; setVersion((v) => v + 1); onStrokeEnd(); };

  const placePin = async (u: number, v: number) => {
    const label = await promptDialog('Pin name', '', 'Place pin');
    if (label === null) return;
    const pin: Pin = { id: uid(), u, v, label, color: PIN_COLORS[pins.length % PIN_COLORS.length] };
    await set({ pins: [...pins, pin] }); setSel(pin.id);
  };
  const updatePin = (id: string, patch: Partial<Pin>) => set({ pins: pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const selPin = pins.find((p) => p.id === sel);

  const shared = {
    N, heights: heights.current, paint: paint.current, sea, aspect, image: f.image as string | undefined, useImage: !!f.useImage,
    version, tool, brush, pins, selectedPin: sel, onStroke, onStrokeEnd, onPlacePin: placePin, onSelectPin: (id: string) => setSel(id), snapshotRef: snapshot,
  };

  const raiseFromPicture = async () => {
    if (!f.image) return;
    if (!(await confirmDialog('Raise the picture into 3D?', 'Lighter parts of the picture become higher ground. This replaces the current land shape (you can undo with Ctrl+Z).', { ok: 'Raise' }))) return;
    undo.current.push({ h: heights.current.slice(), p: paint.current.slice() });
    heights.current = await heightsFromImage(String(f.image), N);
    dirty.current = true; setVersion((v) => v + 1); await saveTerrain();
    await set({ heightScale: Math.max(heightScale, 18), view: '3d' });
  };

  return (
    <div className="map-editor">
      <div className="map-tools" role="toolbar" aria-label="Map tools">
        <div className="seg" role="group" aria-label="View">
          <button className={view === '3d' ? 'on' : ''} onClick={() => set({ view: '3d' })} title="3D view"><Box size={14} /> 3D</button>
          <button className={view === '2d' ? 'on' : ''} onClick={() => set({ view: '2d' })} title="2D view"><Square size={14} /> 2D</button>
        </div>
        <span className="tb-sep" />
        {TOOLS.map((t) => <button key={t.id} className={'tb-btn' + (tool === t.id ? ' on' : '')} title={`${t.label} (${t.key})`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}><t.icon size={15} /></button>)}
        <button className="tb-btn" title="Undo (Ctrl+Z)" onClick={doUndo}><Undo2 size={15} /></button>
        <span className="tb-sep" />
        {tool !== 'view' && tool !== 'pin' && <>
          <label className="mini-range"><span>Size</span><input type="range" min={2} max={40} value={brush} onChange={(e) => setBrush(+e.target.value)} /></label>
          {tool !== 'paint' && <label className="mini-range"><span>Strength</span><input type="range" min={0.1} max={1.5} step={0.05} value={strength} onChange={(e) => setStrength(+e.target.value)} /></label>}
        </>}
        {tool === 'paint' && <div className="biomes">{BIOMES.map((b) => (
          <button key={b.id} className={'biome' + (biome === b.id ? ' on' : '')} title={b.id === 0 ? 'Erase paint (color by height)' : b.name} aria-label={b.name} onClick={() => setBiome(b.id)}
            style={{ background: b.id === 0 ? 'repeating-linear-gradient(45deg, #888 0 4px, #555 4px 8px)' : `rgb(${b.color.join(',')})` }} />
        ))}</div>}
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => setRegen(true)}><Wand2 size={13} /> Land &amp; water</button>
        <button className="btn ghost sm" title="Save a picture of this view" onClick={async () => {
          const url = snapshot.current?.(); if (!url) return;
          const bin = atob(url.split(',')[1]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          if (await saveBinary(`${safeName(map.name)} ${view}.png`, bytes, 'image/png')) toast('Map image saved');
        }}><Download size={13} /> Image</button>
      </div>

      <div className="map-body">
        <div className="map-canvas">
          {view === '3d'
            ? <Terrain3D {...shared} heightScale={heightScale} lowPoly={!!f.lowPoly} />
            : <Map2D {...shared} onMovePin={(id, u, v) => updatePin(id, { u, v })} />}
          <div className="map-hint muted small">
            {view === '3d' ? (tool === 'view' ? 'Drag to orbit · right-drag to pan · scroll to zoom' : 'Left-drag to use the tool · right-drag to orbit · [ ] brush size') : (tool === 'view' ? 'Drag to pan · scroll to zoom · drag pins to move them' : 'Left-drag to use the tool · right-drag to pan · [ ] brush size')}
          </div>
        </div>

        <aside className="map-side">
          <h4>Pins</h4>
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
          <label className="mini-range wide"><span>Sea level</span><input type="range" min={0} max={0.9} step={0.01} value={sea} onChange={(e) => { set({ seaLevel: +e.target.value }); }} /></label>
          {view === '3d' && <label className="mini-range wide"><span>Height</span><input type="range" min={2} max={60} step={1} value={heightScale} onChange={(e) => set({ heightScale: +e.target.value })} /></label>}
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
                  undo.current.push({ h: heights.current.slice(), p: paint.current.slice() });
                  heights.current = generate(N, s); if (s === 'flat') paint.current = new Uint8Array(N * N);
                  dirty.current = true; setVersion((v) => v + 1); saveTerrain(); setRegen(false);
                }}><strong>{s[0].toUpperCase() + s.slice(1)}</strong></button>
              ))}
            </div>
            <div className="row gap-s">
              <button className="btn sm" onClick={() => { undo.current.push({ h: heights.current.slice(), p: paint.current.slice() }); heights.current = smoothAll(heights.current, N, 2); dirty.current = true; setVersion((v) => v + 1); saveTerrain(); }}>Smooth everything</button>
              <button className="btn sm" onClick={() => { undo.current.push({ h: heights.current.slice(), p: paint.current.slice() }); paint.current = new Uint8Array(N * N); dirty.current = true; setVersion((v) => v + 1); saveTerrain(); }}>Clear painted terrain</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
