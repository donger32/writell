import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFlowWatchdog } from './flowWatchdog';
import { ReactFlow, Background, Controls, MiniMap, NodeResizer, Handle, Position, BaseEdge, EdgeLabelRenderer, ConnectionMode, useInternalNode, useStore, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, type EdgeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Wand2, X, Plus, Trash2, ExternalLink, SlidersHorizontal, Network, Circle, Grid3x3, Square, Type, Maximize2, Minimize2 } from 'lucide-react';
import { db, uid, type Entity, type Link } from '../../db';
import { addLink, colorOf, createEntity, removeLink, updateEntity, updateLinkData, sideLabel, sideKey } from '../../entities';
import { allRelTypes, relType, currentRelType, saveDiagramPositions, type Pos, type RelHistory, type RelTypeDef } from '../../story3';
import { Modal, openMenu, toast } from '../ui';
import { Palette } from 'lucide-react';
import { Avatar, Picker, PopButton, useProjectOptions } from '../story/common';
import { openEntity } from '../story/links';
import { TimelineBox } from './TimelineBox';

export type NodeSize = 'small' | 'medium' | 'large';
const AV: Record<NodeSize, number> = { small: 30, medium: 46, large: 66 };
const NODE_W: Record<NodeSize, number> = { small: 78, medium: 96, large: 120 };

type CData = { e: Entity; dim: boolean; count: number; size: NodeSize };
function CharNode({ data, selected }: NodeProps<Node<CData>>) {
  const isChar = data.e.kind === 'character';
  const av = AV[data.size];
  return (
    <div className={'relnode s-' + data.size + (selected ? ' on' : '') + (data.dim ? ' dim' : '') + (isChar ? '' : ' thing')} style={{ width: NODE_W[data.size] }} onDoubleClick={() => openEntity(data.e)} title="Drag the + onto another character to add a relationship">
      <Handle type="source" position={Position.Top} className="hidden-handle" style={{ top: av - 2, left: `calc(50% + ${av / 2 - 3}px)` }} />
      <Avatar name={data.e.name} color={data.e.fields.color as string | undefined} image={data.e.fields.image as string | undefined} size={av} round={isChar} />
      {data.count > 0 && <span className="relcount" style={{ right: NODE_W[data.size] / 2 - av / 2 - 8 }}>{data.count}</span>}
      <span className="ellipsis" style={{ maxWidth: NODE_W[data.size] }}>{data.e.name}</span>
    </div>
  );
}

/* ---- Your own boxes and text on the map ---- */
export interface MapNote { id: string; kind: 'box' | 'text'; x: number; y: number; w: number; h: number; color: string; title: string }
const NOTE_COLORS = ['#8b7cf6', '#5fa8f5', '#4fbf8f', '#d6b24a', '#e8925a', '#e06c75', '#c678dd', '#8b8d98'];
type NData = { note: MapNote; onEdit: (patch: Partial<MapNote>) => void; onResized: (w: number, h: number, x: number, y: number) => void };

/** Click-to-edit text inside a note (double-click to edit, click away or Ctrl+Enter to finish) */
function NoteText({ value, placeholder, multiline, onSave, className }: { value: string; placeholder: string; multiline?: boolean; onSave: (v: string) => void; className: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { if (!editing) setV(value); }, [value, editing]);
  const done = () => { setEditing(false); if (v !== value) onSave(v); };
  if (!editing) return <div className={className + (value ? '' : ' empty')} onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>{value || placeholder}</div>;
  return <textarea className={className + ' editing nodrag nowheel'} autoFocus value={v} rows={multiline ? 3 : 1} placeholder={placeholder}
    onChange={(e) => setV(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))} onBlur={done}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey))) { e.preventDefault(); done(); } }} />;
}

function BoxNode({ data, selected }: NodeProps<Node<NData>>) {
  const n = data.note;
  return (
    <div className={'relbox' + (selected ? ' on' : '')} style={{ ['--bc' as string]: n.color }}>
      <NodeResizer isVisible={selected} minWidth={140} minHeight={90} color={n.color} onResizeEnd={(_e, p) => data.onResized(p.width, p.height, p.x, p.y)} />
      <NoteText className="relbox-title" value={n.title} placeholder="Double-click to name this box" onSave={(title) => data.onEdit({ title })} />
    </div>
  );
}
function TextNode({ data, selected }: NodeProps<Node<NData>>) {
  const n = data.note;
  return (
    <div className={'reltext' + (selected ? ' on' : '')} style={{ ['--bc' as string]: n.color }}>
      <NodeResizer isVisible={selected} minWidth={120} minHeight={40} color={n.color} onResizeEnd={(_e, p) => data.onResized(p.width, p.height, p.x, p.y)} />
      <NoteText className="reltext-body" multiline value={n.title} placeholder="Double-click to write a note" onSave={(title) => data.onEdit({ title })} />
    </div>
  );
}
const nodeTypes = { char: CharNode, box: BoxNode, text: TextNode };

type RData = { color: string; dashed: boolean; label: string; bend: number; selected: boolean };
/** Line that runs from the edge of one picture straight towards the other, bending apart when two people share several relationships */
function RelEdge({ id, source, target, data }: EdgeProps<Edge<RData>>) {
  const a = useInternalNode(source), b = useInternalNode(target);
  // zoomed far out, labels would only be clutter: show them for the selected line only
  const zoom = useStore((st) => st.transform[2]);
  if (!a || !b || !data) return null;
  const av = AV[((a.data as CData | undefined)?.size) ?? 'medium'];
  const ca = { x: a.internals.positionAbsolute.x + (a.measured.width ?? 96) / 2, y: a.internals.positionAbsolute.y + 6 + av / 2 };
  const cb = { x: b.internals.positionAbsolute.x + (b.measured.width ?? 96) / 2, y: b.internals.positionAbsolute.y + 6 + av / 2 };
  // keep the same bend direction no matter which way round the link was made
  const flip = source < target ? 1 : -1;
  const dx = cb.x - ca.x, dy = cb.y - ca.y, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * flip, ny = (dx / len) * flip;
  const mid = { x: (ca.x + cb.x) / 2 + nx * data.bend, y: (ca.y + cb.y) / 2 + ny * data.bend };
  const pull = (from: { x: number; y: number }, to: { x: number; y: number }, r: number) => { const ux = to.x - from.x, uy = to.y - from.y, l = Math.hypot(ux, uy) || 1; return { x: from.x + (ux / l) * r, y: from.y + (uy / l) * r }; };
  const s = pull(ca, mid, av / 2 + 5), t = pull(cb, mid, av / 2 + 5);
  const path = `M ${s.x} ${s.y} Q ${mid.x} ${mid.y} ${t.x} ${t.y}`;
  const lx = 0.25 * s.x + 0.5 * mid.x + 0.25 * t.x, ly = 0.25 * s.y + 0.5 * mid.y + 0.25 * t.y;
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={18} style={{ stroke: data.color, strokeWidth: data.selected ? 3.5 : 2.2, strokeDasharray: data.dashed ? '6 5' : undefined }} />
      {(zoom >= 0.55 || data.selected) && <EdgeLabelRenderer>
        <div className={'rel-label' + (data.selected ? ' on' : '')} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, borderColor: data.color }}>{data.label}</div>
      </EdgeLabelRenderer>}
    </>
  );
}
const edgeTypes = { rel: RelEdge };

async function getMap(projectId: string): Promise<Entity> {
  const m = await db.entities.where('[projectId+kind]').equals([projectId, 'relmap']).first();
  if (m) return m;
  const id = await createEntity(projectId, 'relmap', 'Relationship map', { positions: {} });
  return (await db.entities.get(id))!;
}

function circle(ids: string[]): Record<string, Pos> {
  const r = Math.max(220, ids.length * 42);
  return Object.fromEntries(ids.map((id, i) => [id, { x: r + r * Math.cos((2 * Math.PI * i) / ids.length - Math.PI / 2), y: r + r * Math.sin((2 * Math.PI * i) / ids.length - Math.PI / 2) }]));
}

/** Spread people out so connected ones sit together and nobody overlaps (a small force simulation) */
export function groupLayout(ids: string[], links: { fromId: string; toId: string }[], start: Record<string, Pos>): Record<string, Pos> {
  const n = ids.length;
  if (!n) return {};
  const at = new Map(ids.map((id, i) => [id, i]));
  const ring = circle(ids);
  const P = ids.map((id) => ({ ...(start[id] ?? ring[id]) }));
  const pairs = new Set<string>();
  const E: [number, number][] = [];
  for (const l of links) {
    const a = at.get(l.fromId), b = at.get(l.toId);
    if (a === undefined || b === undefined || a === b) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!pairs.has(k)) { pairs.add(k); E.push([a, b]); }
  }
  const K = 190; // comfortable distance between connected people
  const steps = 420;
  for (let it = 0; it < steps; it++) {
    const temp = 70 * (1 - it / steps) + 3;
    const D = P.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y;
      let d = Math.hypot(dx, dy);
      if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 0.5; }
      const f = (K * K) / d * (d < 130 ? 3 : 1);
      D[i].x += (dx / d) * f; D[i].y += (dy / d) * f; D[j].x -= (dx / d) * f; D[j].y -= (dy / d) * f;
    }
    for (const [a, b] of E) {
      const dx = P[a].x - P[b].x, dy = P[a].y - P[b].y, d = Math.hypot(dx, dy) || 0.01;
      const f = (d * d) / K;
      D[a].x -= (dx / d) * f; D[a].y -= (dy / d) * f; D[b].x += (dx / d) * f; D[b].y += (dy / d) * f;
    }
    const cx = P.reduce((s, p) => s + p.x, 0) / n, cy = P.reduce((s, p) => s + p.y, 0) / n;
    for (let i = 0; i < n; i++) {
      D[i].x += (cx - P[i].x) * 0.06 * K / 10; D[i].y += (cy - P[i].y) * 0.06 * K / 10; // gentle pull to the middle keeps loners close
      const d = Math.hypot(D[i].x, D[i].y) || 1, m = Math.min(d, temp);
      P[i].x += (D[i].x / d) * m; P[i].y += (D[i].y / d) * m;
    }
  }
  const minX = Math.min(...P.map((p) => p.x)), minY = Math.min(...P.map((p) => p.y));
  return Object.fromEntries(ids.map((id, i) => [id, { x: Math.round(P[i].x - minX), y: Math.round(P[i].y - minY) }]));
}
/** A–Z in rows */
function gridLayout(people: Entity[]): Record<string, Pos> {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.6)));
  return Object.fromEntries(sorted.map((c, i) => [c.id, { x: (i % cols) * 150, y: Math.floor(i / cols) * 150 }]));
}

/** The project's custom relationship types */
const NO_TYPES: RelTypeDef[] = [];
export function useRelTypes(projectId: string): RelTypeDef[] {
  return useLiveQuery(async () => (await db.projects.get(projectId))?.relTypes ?? NO_TYPES, [projectId]) ?? NO_TYPES;
}

export function RelationshipMapView({ projectId }: { projectId: string }) {
  const opts = useProjectOptions(projectId);
  const custom = useRelTypes(projectId);
  const TYPES = allRelTypes(custom);
  const [editTypes, setEditTypes] = useState(false);
  useEffect(() => { getMap(projectId); }, [projectId]);
  const map = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'relmap']).first(), [projectId]);
  const links = useLiveQuery(() => db.links.where('projectId').equals(projectId).filter((l) => l.relation === 'related').toArray(), [projectId]);
  const [focus, setFocus] = useState<string>('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [showThings, setShowThings] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [selNote, setSelNote] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const rf = useRef<ReactFlowInstance | null>(null);
  const carry = useRef<{ start: Pos; members: { id: string; pos: Pos }[] } | null>(null);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const edgesShown = edges.filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target)).length;
  const flowKey = useFlowWatchdog(canvasRef, edgesShown, [nodes, edges]);

  const chars = useMemo(() => opts?.entities.filter((e) => e.kind === 'character') ?? [], [opts]);
  // optional: places, factions and other worldbuilding entries connected to characters
  const things = useMemo(() => {
    if (!showThings || !opts) return [];
    const charIds = new Set(chars.map((c) => c.id));
    const ids = new Set((links ?? []).flatMap((l) => (charIds.has(l.fromId) ? [l.toId] : charIds.has(l.toId) ? [l.fromId] : [])));
    return opts.entities.filter((e) => e.kind === 'world' && ids.has(e.id));
  }, [showThings, opts, chars, links]);
  const charLinks = useMemo(() => {
    const ids = new Set([...chars, ...things].map((c) => c.id));
    return (links ?? []).filter((l) => ids.has(l.fromId) && ids.has(l.toId));
  }, [links, chars, things]);

  /* ---- boxes & text ---- */
  const writeNotes = async (fn: (list: MapNote[]) => MapNote[]) => {
    const m = await getMap(projectId);
    await updateEntity(m.id, { fields: { notes: fn((m.fields.notes as MapNote[] | undefined) ?? []) } });
  };
  const editNote = (id: string, patch: Partial<MapNote>) => writeNotes((l) => l.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const addNote = async (kind: MapNote['kind']) => {
    const el = canvasRef.current; const inst = rf.current;
    const c = el && inst ? inst.screenToFlowPosition({ x: el.getBoundingClientRect().left + el.clientWidth / 2, y: el.getBoundingClientRect().top + el.clientHeight / 2 }) : { x: 0, y: 0 };
    const w = kind === 'box' ? 360 : 220, h = kind === 'box' ? 240 : 80;
    const n: MapNote = { id: uid(), kind, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h, color: kind === 'box' ? '#8b7cf6' : '#d6b24a', title: '' };
    await writeNotes((l) => [...l, n]);
    setSelNote(n.id); setSel(null);
  };
  const deleteNote = async (id: string) => { await writeNotes((l) => l.filter((n) => n.id !== id)); setSelNote(null); };
  const arrange = async (how: 'group' | 'circle' | 'grid') => {
    const m = await getMap(projectId);
    const before = (m.fields.positions as Record<string, Pos>) ?? {};
    const people = [...chars, ...things];
    const next = how === 'circle' ? circle(people.map((c) => c.id)) : how === 'grid' ? gridLayout(people) : groupLayout(people.map((c) => c.id), charLinks, before);
    await saveDiagramPositions(m.id, { ...before, ...next });
    setTimeout(() => rf.current?.fitView({ padding: 0.2, duration: 300 }), 60);
    toast('Arranged', { label: 'Undo', run: () => saveDiagramPositions(m.id, before) });
  };
  useEffect(() => {
    if (!selNote) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !t.closest('input, textarea, [contenteditable="true"]')) { e.preventDefault(); deleteNote(selNote); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [selNote]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea') && !document.querySelector('.pop-panel, .ctxmenu, .modal, .dialog')) setBig(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [big]);

  useEffect(() => {
    if (!map || !opts) return;
    const visibleLinks = charLinks.filter((l) => !hidden.has(relType(currentRelType(l), custom).id) && (!focus || l.fromId === focus || l.toId === focus));
    const linked = new Set(visibleLinks.flatMap((l) => [l.fromId, l.toId]));
    const everyone = [...chars, ...things];
    const shown = everyone.filter((c) => (!onlyLinked && !focus && c.kind === 'character') || linked.has(c.id) || c.id === focus);
    let pos = (map.fields.positions as Record<string, Pos>) ?? {};
    const missing = everyone.filter((c) => !pos[c.id]);
    if (missing.length) {
      pos = { ...pos };
      const ring = circle(everyone.map((c) => c.id));
      const free = (p: Pos) => Object.values(pos).every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 130);
      for (const m of missing) {
        // next to something it's connected to, in the first free direction
        const nb = charLinks.map((l) => (l.fromId === m.id ? l.toId : l.toId === m.id ? l.fromId : null)).find((x) => x && pos[x]);
        let spot: Pos = ring[m.id];
        if (nb) for (let k = 0; k < 16; k++) {
          const a = (k * Math.PI) / 8 + Math.PI / 6, r = 170 + Math.floor(k / 8) * 90;
          const p = { x: pos[nb].x + Math.cos(a) * r, y: pos[nb].y + Math.sin(a) * r };
          if (free(p)) { spot = p; break; }
        }
        pos[m.id] = spot;
      }
      saveDiagramPositions(map.id, pos);
    }
    const count = (id: string) => charLinks.filter((l) => l.fromId === id || l.toId === id).length;
    const size = ((map.fields.nodeSize as NodeSize) || 'medium');
    const notes = (map.fields.notes as MapNote[] | undefined) ?? [];
    // keep each node's measured size: new node objects without it stay hidden until the next full re-mount
    setNodes((prev) => [
      ...notes.map((n): Node => {
        const id = 'note:' + n.id, old = prev.find((x) => x.id === id);
        return { ...(old ?? {}), id, type: n.kind, position: { x: n.x, y: n.y }, width: n.w, height: n.h, zIndex: n.kind === 'box' ? -1 : 2, selected: selNote === n.id,
          data: { note: n, onEdit: (patch: Partial<MapNote>) => editNote(n.id, patch), onResized: (w: number, h: number, x: number, y: number) => editNote(n.id, { w: Math.round(w), h: Math.round(h), x: Math.round(x), y: Math.round(y) }) } };
      }),
      ...shown.map((c): Node => {
        const old = prev.find((n) => n.id === c.id);
        return { ...(old ?? {}), id: c.id, type: 'char', position: pos[c.id], data: { e: c, dim: !!focus && c.id !== focus && !linked.has(c.id), count: count(c.id), size } };
      }),
    ]);
    // several relationships between the same two → spread them out side by side
    const pairKey = (l: Link) => [l.fromId, l.toId].sort().join('|');
    const groups = new Map<string, Link[]>();
    for (const l of visibleLinks) groups.set(pairKey(l), [...(groups.get(pairKey(l)) ?? []), l]);
    setEdges(visibleLinks.map((l) => {
      const t = relType(currentRelType(l), custom);
      const g = groups.get(pairKey(l))!;
      const i = g.indexOf(l);
      const bend = g.length === 1 ? 0 : (i - (g.length - 1) / 2) * 64;
      const label = [sideLabel(l, l.fromId), sideLabel(l, l.toId)].filter(Boolean).join(' / ') || t.label;
      return { id: l.id, source: l.fromId, target: l.toId, type: 'rel', selected: l.id === sel, data: { color: t.color, dashed: t.id === 'secret' || t.id === 'former-partner', label, bend, selected: l.id === sel } };
    }));
  }, [map, opts, charLinks, things, hidden, focus, onlyLinked, sel, custom, selNote]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!opts || !map || !links) return null;
  const selLink = charLinks.find((l) => l.id === sel);
  void edgesShown;

  const size = ((map.fields.nodeSize as NodeSize) || 'medium');
  const note = ((map.fields.notes as MapNote[] | undefined) ?? []).find((n) => n.id === selNote);
  return (
    <div className={'visual relmap' + (big ? ' big' : '')}>
      <div className="visual-bar">
        <h2>Relation</h2>
        <select className="pill-select" value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Focus on a character">
          <option value="">All characters</option>
          {[...chars].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })).map((c) => <option key={c.id} value={c.id}>Focus: {c.name}</option>)}
        </select>
        <PopButton icon={<SlidersHorizontal size={13} />} label="View">
          <div className="pop-label">Picture size</div>
          <div className="seg">{(['small', 'medium', 'large'] as NodeSize[]).map((z) => <button key={z} className={size === z ? 'on' : ''} onClick={() => updateEntity(map.id, { fields: { nodeSize: z } })}>{z[0].toUpperCase() + z.slice(1)}</button>)}</div>
          <label className="check small"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} /> Hide characters with no relationships</label>
          <label className="check small"><input type="checkbox" checked={showThings} onChange={(e) => setShowThings(e.target.checked)} /> Show places &amp; groups they're linked to</label>
        </PopButton>
        <button className="btn ghost sm" onClick={(ev) => openMenu(ev, [
          { label: 'Group by connections', hint: 'People who know each other end up close together', icon: <Network size={14} />, onClick: () => arrange('group') },
          { label: 'Circle', hint: 'Everyone in a ring', icon: <Circle size={14} />, onClick: () => arrange('circle') },
          { label: 'Grid, A–Z', hint: 'Tidy rows in name order', icon: <Grid3x3 size={14} />, onClick: () => arrange('grid') },
        ])}><Wand2 size={13} /> Arrange</button>
        <span className="tb-sep" />
        <button className="btn ghost sm" onClick={() => addNote('box')} title="Draw a box around a group and give it a name"><Square size={13} /> Box</button>
        <button className="btn ghost sm" onClick={() => addNote('text')} title="Write a note anywhere on the map"><Type size={13} /> Text</button>
        <span className="grow" />
        <button className="icon-btn" onClick={() => setBig((b) => !b)} title={big ? 'Back to normal size (Esc)' : 'Use the whole window'} aria-label={big ? 'Exit full window' : 'Use the whole window'}>{big ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
      <div className="filter-chips legend">
        {TYPES.map((t) => (
          <button key={t.id} className={'chip' + (!hidden.has(t.id) ? ' on' : '')} onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
            <span className="dot" style={{ background: t.color }} /> {t.label}
          </button>
        ))}
        <button className="chip" onClick={() => setEditTypes(true)}><Palette size={11} /> Custom types…</button>
      </div>
      <div className="canvas-wrap">
        <div className="canvas" ref={canvasRef}>
          <ReactFlow key={flowKey} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose} connectionRadius={70} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onInit={(i) => { rf.current = i; }}
            fitView fitViewOptions={{ padding: 0.25, maxZoom: 1 }} minZoom={0.05} maxZoom={2.5} proOptions={{ hideAttribution: true }} deleteKeyCode={null}
            onNodeDragStart={(_e, n) => {
              if (n.type !== 'box') { carry.current = null; return; }
              // a box takes the people inside it along when you move it
              const w = n.measured?.width ?? n.width ?? 0, h = n.measured?.height ?? n.height ?? 0;
              const inside = nodes.filter((x) => x.type === 'char' && (() => { const cx = x.position.x + (x.measured?.width ?? 96) / 2, cy = x.position.y + (x.measured?.height ?? 80) / 2; return cx > n.position.x && cx < n.position.x + w && cy > n.position.y && cy < n.position.y + h; })());
              carry.current = { start: { ...n.position }, members: inside.map((x) => ({ id: x.id, pos: { ...x.position } })) };
            }}
            onNodeDrag={(_e, n) => {
              const c = carry.current; if (!c || !c.members.length) return;
              const dx = n.position.x - c.start.x, dy = n.position.y - c.start.y;
              setNodes((ns) => ns.map((x) => { const m = c.members.find((q) => q.id === x.id); return m ? { ...x, position: { x: m.pos.x + dx, y: m.pos.y + dy } } : x; }));
            }}
            onNodeDragStop={async (_e, _n, moved) => {
              const c = carry.current; carry.current = null;
              const fresh = (await db.entities.get(map.id))!;
              const p = { ...(fresh.fields.positions as Record<string, Pos>) };
              const notesMoved = new Map<string, Pos>();
              for (const n of moved) {
                if (n.id.startsWith('note:')) {
                  notesMoved.set(n.id.slice(5), n.position);
                  if (c) { const dx = n.position.x - c.start.x, dy = n.position.y - c.start.y; for (const m of c.members) p[m.id] = { x: m.pos.x + dx, y: m.pos.y + dy }; }
                } else p[n.id] = n.position;
              }
              const notes = ((fresh.fields.notes as MapNote[] | undefined) ?? []).map((n) => { const q = notesMoved.get(n.id); return q ? { ...n, x: Math.round(q.x), y: Math.round(q.y) } : n; });
              await updateEntity(map.id, { fields: { positions: p, notes } });
            }}
            onConnect={async (c) => { if (!c.source || !c.target || c.source === c.target || c.source.startsWith('note:') || c.target.startsWith('note:')) return; const id = await newRelationship(projectId, c.source, c.target); setSel(id); }}
            onEdgeClick={(_e, ed) => { setSel(ed.id); setSelNote(null); }} onPaneClick={() => { setSel(null); setSelNote(null); }}
            onNodeClick={(_e, n) => { if (n.id.startsWith('note:')) { setSelNote(n.id.slice(5)); setSel(null); } else { setSelNote(null); setFocus((f) => (f === n.id ? '' : f)); } }}>
            <Background gap={24} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            {nodes.length > 25 && <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'char' ? colorOf((n.data as CData).e) : 'transparent')} nodeStrokeColor={(n) => (n.type === 'box' ? (n.data as NData).note.color : 'transparent')} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" style={{ background: 'var(--panel)' }} />}
          </ReactFlow>
          {note && (
            <div className="note-tools" role="toolbar" aria-label={note.kind === 'box' ? 'Box' : 'Text'}>
              {NOTE_COLORS.map((c) => <button key={c} className={'swatch' + (note.color === c ? ' on' : '')} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => editNote(note.id, { color: c })} />)}
              <span className="tb-sep" />
              <span className="muted small">Double-click to {note.kind === 'box' ? 'name it' : 'edit'}{note.kind === 'box' ? ' · moving it moves the people inside' : ''}</span>
              <button className="icon-btn sm" title="Delete (Del)" aria-label="Delete" onClick={() => deleteNote(note.id)}><Trash2 size={13} /></button>
            </div>
          )}
          {!chars.length && <div className="canvas-empty"><p className="muted">Create characters first. Then drag from one character to another to connect them.</p></div>}
        </div>
        {selLink && <RelationshipPanel key={selLink.id} link={selLink} opts={opts} types={TYPES} onClose={() => setSel(null)} onEditTypes={() => setEditTypes(true)} onSelect={setSel} />}
        {editTypes && <RelTypesEditor projectId={projectId} custom={custom} onClose={() => setEditTypes(false)} />}
      </div>
      <p className="muted small canvas-hint">Drag a character's + onto another to add a relationship · click a line to edit it · double-click a picture to open the profile · Box and Text let you group people and leave yourself notes</p>
    </div>
  );
}

export function RelationshipPanel({ link, opts, onClose, types, onEditTypes, onSelect }: { link: Link; opts: NonNullable<ReturnType<typeof useProjectOptions>>; onClose: () => void; types: RelTypeDef[]; onEditTypes?: () => void; onSelect?: (id: string) => void }) {
  const rt = (id: unknown) => types.find((t) => t.id === id) ?? types[types.length - 1];
  const a = opts.byId.get(link.fromId)!, b = opts.byId.get(link.toId)!;
  const history = (link.data.history as RelHistory[] | undefined) ?? [];
  const events = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([link.projectId, 'event']).toArray(), [link.projectId]);
  const setHistory = (h: RelHistory[]) => updateLinkData(link.id, { history: h });
  if (!a || !b) return null;
  return (
    <div className="inspector wide" key={link.id}>
      <div className="row gap-s"><strong className="grow">{a.name} &amp; {b.name}</strong><button className="icon-btn sm" onClick={onClose}><X size={13} /></button></div>
      <label className="sfield"><span>Relationship type</span>
        <div className="row gap-s"><select className="input" value={String(link.data.type ?? 'other')} onChange={(e) => e.target.value === '__new' ? onEditTypes?.() : updateLinkData(link.id, { type: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}{onEditTypes && <option value="__new">+ Make a custom type…</option>}</select></div></label>
      <div className="fgrid">
        <label className="sfield"><span>{a.name} is {b.name}'s…</span><input className="input" defaultValue={sideLabel(link, a.id)} placeholder="e.g. mentor" onBlur={(e) => updateLinkData(link.id, { [sideKey(link, a.id)]: e.target.value })} /></label>
        <label className="sfield"><span>{b.name} is {a.name}'s…</span><input className="input" defaultValue={sideLabel(link, b.id)} placeholder="e.g. student" onBlur={(e) => updateLinkData(link.id, { [sideKey(link, b.id)]: e.target.value })} /></label>
      </div>
      <label className="sfield"><span>When it began</span><input className="input" defaultValue={String(link.data.began ?? '')} placeholder="e.g. Chapter 3, or spring 1998" onBlur={(e) => updateLinkData(link.id, { began: e.target.value })} /></label>

      <div className="row"><h4 className="grow">How it develops</h4>
        <button className="btn ghost sm" onClick={() => setHistory([...history, { id: uid(), when: '', type: String(history[history.length - 1]?.type ?? link.data.type ?? 'other'), note: '' }])}><Plus size={13} /> Add change</button></div>
      {history.length > 0 && (
        <div className="relhist-strip">
          <span className="relhist-pill" style={{ borderColor: rt(link.data.type).color }}>{rt(link.data.type).label}</span>
          {history.map((h) => <span key={h.id} className="row"><span className="muted">→</span><span className="relhist-pill" style={{ borderColor: rt(h.type).color }}>{rt(h.type).label}</span></span>)}
        </div>
      )}
      <div className="relhist">
        {history.map((h, i) => (
          <div key={h.id} className="relhist-item">
            <div className="row gap-s">
              <select className="pill-select" value={h.type} onChange={(e) => setHistory(history.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              <input className="input sm grow" defaultValue={h.when} placeholder="When (e.g. Ch. 12)" onBlur={(e) => setHistory(history.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)))} />
              <button className="icon-btn sm" onClick={() => setHistory(history.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
            <select className="input sm" value={h.eventId ?? ''} onChange={(e) => setHistory(history.map((x, j) => (j === i ? { ...x, eventId: e.target.value || undefined } : x)))}>
              <option value="">Linked timeline event (optional)</option>
              {events?.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
            <textarea className="input" rows={2} defaultValue={h.note} placeholder="Why did it change?" onBlur={(e) => setHistory(history.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
          </div>
        ))}
        {!history.length && <p className="muted small">Record turning points, e.g. Enemies → Reluctant allies → Friends, and why each change happened.</p>}
      </div>
      <h4>On the timeline</h4>
      <TimelineBox projectId={link.projectId} kind="relationship" id={link.id} name={`${a.name} & ${b.name}`} involve={[a.id, b.id]} />
      <label className="sfield"><span>Notes</span><textarea className="input" rows={3} defaultValue={String(link.data.note ?? '')} onBlur={(e) => updateLinkData(link.id, { note: e.target.value })} /></label>
      <div className="row gap-s">
        <button className="btn sm" onClick={() => openEntity(a)}><ExternalLink size={13} /> {a.name}</button>
        <button className="btn sm" onClick={() => openEntity(b)}><ExternalLink size={13} /> {b.name}</button>
        <span className="grow" />
        <button className="btn ghost sm danger-text" onClick={async () => { await removeLink(link.id); onClose(); }}><Trash2 size={13} /> Delete</button>
      </div>
      <div className="row gap-s">
        <button className="btn sm" onClick={async () => { const id = await newRelationship(link.projectId, link.fromId, link.toId); onSelect?.(id); }}><Plus size={13} /> Add another relationship between them</button>
      </div>
    </div>
  );
}

/** Used on character profiles: add a relationship with a picker */
export function AddRelationship({ projectId, entityId }: { projectId: string; entityId: string }) {
  const opts = useProjectOptions(projectId);
  if (!opts) return null;
  return <Picker options={opts.characterOpts.filter((o) => o.id !== entityId)} buttonLabel="Add" onPick={(id) => addLink(projectId, 'entity', entityId, 'entity', id, 'related', { type: 'friend' })} />;
}

const SWATCHES = ['#e06c75', '#e8925a', '#e8c547', '#5fbf8f', '#6bc4c4', '#5fa8f5', '#8b7cf6', '#d17ad8', '#e47fb4', '#a0826d', '#8b8d98'];

/** Create, rename, recolour and delete the project's own relationship types */
function RelTypesEditor({ projectId, custom, onClose }: { projectId: string; custom: RelTypeDef[]; onClose: () => void }) {
  const [list, setList] = useState<RelTypeDef[]>(custom.map((c) => ({ ...c })));
  const [name, setName] = useState('');
  const add = () => { if (!name.trim()) return; setList([...list, { id: 'c-' + uid().slice(0, 8), label: name.trim(), color: SWATCHES[list.length % SWATCHES.length] }]); setName(''); };
  const save = async () => { await db.projects.update(projectId, { relTypes: list.filter((t) => t.label.trim()).map(({ id, label, color }) => ({ id, label: label.trim(), color })) }); onClose(); };
  return (
    <Modal title="Relationship types" onClose={onClose}>
      <div className="pad col gap">
        <p className="muted small">Add your own kinds of relationship, like “Sworn enemies”, “Blood oath”, “Unrequited love” or “Business partners”. Each gets its own color on the map. Built-in types stay available too.</p>
        <div className="col gap-s">
          {list.map((t, i) => (
            <div key={t.id} className="row gap-s">
              <input type="color" className="swatch-input" value={t.color} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} aria-label={`Color for ${t.label}`} />
              <input className="input sm grow" value={t.label} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Type name" />
              <button className="icon-btn sm" title="Delete type (relationships using it become “Other”)" onClick={() => setList(list.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
          ))}
          {!list.length && <p className="muted small">No custom types yet.</p>}
        </div>
        <div className="row gap-s"><input className="input sm grow" placeholder="New type, e.g. Sworn enemies" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><button className="btn sm" onClick={add}><Plus size={13} /> Add</button></div>
        <div className="row end gap-s"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save types</button></div>
      </div>
    </Modal>
  );
}

/** Always a new relationship, even if these two already have one (e.g. former partners AND enemies) */
async function newRelationship(projectId: string, a: string, b: string): Promise<string> {
  const id = uid();
  const t = Date.now();
  await db.links.add({ id, projectId, fromType: 'entity', fromId: a, toType: 'entity', toId: b, relation: 'related', data: { type: 'friend' }, createdAt: t, updatedAt: t });
  return id;
}
