import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type Connection, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Wand2, Trash2, Pencil, UserPlus, X, ExternalLink } from 'lucide-react';
import { db, type Entity, type Link } from '../../db';
import { createEntity, updateEntity, deleteEntity, removeLink, updateLinkData } from '../../entities';
import { toastTrashed } from '../TrashView';
import { FAMILY_TYPES, addFamilyLink, familyType, layoutFamily, saveDiagramPositions, CARD_W, type Pos } from '../../story3';
import { go } from '../../nav';
import { promptDialog } from '../ui';
import { Avatar, Picker, useProjectOptions } from '../story/common';
import { useFlowWatchdog } from './flowWatchdog';
import { openEntity } from '../story/links';
import { lifespan } from '../../charDates';

type PersonData = { e: Entity; selected?: boolean };

function PersonNode({ data, selected }: NodeProps<Node<PersonData>>) {
  const e = data.e;
  const age = e.fields.age ? `Age ${e.fields.age}` : lifespan(e);
  const status = String(e.fields.status ?? '');
  return (
    <div className={'person' + (selected ? ' on' : '') + (status === 'Dead' ? ' dead' : '')} onDoubleClick={() => openEntity(e)}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Left} id="left" />
      <Avatar name={e.name} color={e.fields.color as string | undefined} image={e.fields.image as string | undefined} size={44} />
      <div className="col" style={{ minWidth: 0 }}>
        <strong className="ellipsis">{e.name}</strong>
        <span className="muted small ellipsis">{[age, status && status !== 'Alive' ? status : ''].filter(Boolean).join(' · ')}</span>
        {!!e.fields.treeNote && <span className="muted small ellipsis">{String(e.fields.treeNote)}</span>}
      </div>
    </div>
  );
}
const nodeTypes = { person: PersonNode };

export function FamilyTreesView({ projectId, entityId }: { projectId: string; entityId?: string }) {
  const trees = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'familytree']).sortBy('createdAt'), [projectId]);
  const tree = trees?.find((t) => t.id === entityId) ?? trees?.[0];
  if (!trees) return null;
  const create = async () => {
    const name = await promptDialog('Name of the new family tree', 'Family tree', 'Create');
    if (!name) return;
    const id = await createEntity(projectId, 'familytree', name, { members: [], positions: {} });
    go({ view: 'family', projectId, entityId: id });
  };
  return (
    <div className="visual">
      <div className="visual-bar">
        <h2>Tree</h2>
        <div className="seg">
          {trees.map((t) => <button key={t.id} className={t.id === tree?.id ? 'on' : ''} onClick={() => go({ view: 'family', projectId, entityId: t.id })}>{t.name}</button>)}
        </div>
        <button className="btn sm" onClick={create}><Plus size={13} /> New tree</button>
        {tree && <>
          <button className="icon-btn" title="Rename tree" onClick={async () => { const n = await promptDialog('Rename tree', tree.name); if (n) updateEntity(tree.id, { name: n }); }}><Pencil size={14} /></button>
          <button className="icon-btn" title="Delete tree (characters are kept)" onClick={async () => { go({ view: 'family', projectId }); toastTrashed(tree.name, await deleteEntity(tree.id)); }}><Trash2 size={14} /></button>
        </>}
      </div>
      {tree ? <TreeCanvas key={tree.id} tree={tree} projectId={projectId} /> : (
        <div className="edetail-empty"><h3>Tree</h3><p className="muted">Build genealogy diagrams from your characters: parents, adoptions, marriages and remarriages, half- and step-siblings, unknown parents. You can have as many trees as you like.</p><button className="btn primary" onClick={create}><Plus size={14} /> New tree</button></div>
      )}
    </div>
  );
}

function TreeCanvas({ tree, projectId }: { tree: Entity; projectId: string }) {
  const opts = useProjectOptions(projectId);
  const links = useLiveQuery(() => db.links.where('projectId').equals(projectId).filter((l) => l.relation === 'family').toArray(), [projectId]);
  const members = (tree.fields.members as string[]) ?? [];
  const positions = (tree.fields.positions as Record<string, Pos>) ?? {};
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [pending, setPending] = useState<Connection | null>(null);
  const flow = useRef<ReactFlowInstance<Node<PersonData>, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PersonData>>([]);
  const memberCount = members.length;
  useEffect(() => { const t = setTimeout(() => flow.current?.fitView({ padding: 0.3, maxZoom: 1, duration: 300 }), 120); return () => clearTimeout(t); }, [memberCount]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowKey = useFlowWatchdog(canvasRef, edges.length, [nodes, edges]);

  const memberEntities = useMemo(() => members.map((id) => opts?.byId.get(id)).filter(Boolean) as Entity[], [members, opts]);

  // build nodes / edges whenever data changes
  useEffect(() => {
    if (!opts || !links) return;
    const missing = memberEntities.filter((e) => !positions[e.id]);
    let pos = positions;
    if (missing.length) {
      const auto = layoutFamily(members, links);
      pos = { ...auto, ...positions };
      // place newcomers that auto-layout put on top of manual cards
      saveDiagramPositions(tree.id, pos);
    }
    setNodes((prev) => memberEntities.map((e) => {
      const old = prev.find((n) => n.id === e.id);
      return { ...(old ?? {}), id: e.id, type: 'person', position: pos[e.id] ?? { x: 0, y: 0 }, data: { e }, selected: e.id === selNode };
    }));
    const set = new Set(members);
    setEdges(links.filter((l) => set.has(l.fromId) && set.has(l.toId)).map((l): Edge => {
      const t = familyType(String(l.data.type));
      const label = t.id === 'custom' ? String(l.data.label ?? '') : t.group === 'parent' && t.id !== 'parent' ? t.label.split(' →')[0].replace(' parent', '') : t.id === 'former-spouse' ? 'former' : t.id === 'half-sibling' ? 'half' : t.id === 'step-sibling' ? 'step' : '';
      const common = { id: l.id, label: label || undefined, selected: l.id === selEdge, labelBgStyle: { fill: 'var(--panel)' }, labelStyle: { fill: 'var(--muted)', fontSize: 11 } };
      if (t.group === 'parent') return { ...common, source: l.fromId, target: l.toId, sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { strokeDasharray: t.dashed ? '6 4' : undefined, strokeWidth: 1.6 }, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } };
      if (t.group === 'partner') {
        const [a, b] = (pos[l.fromId]?.x ?? 0) <= (pos[l.toId]?.x ?? 0) ? [l.fromId, l.toId] : [l.toId, l.fromId];
        return { ...common, source: a, target: b, sourceHandle: 'right', targetHandle: 'left', type: 'straight', className: 'edge-partner', style: { strokeDasharray: t.dashed ? '6 4' : undefined, strokeWidth: 2.2 } };
      }
      return { ...common, source: l.fromId, target: l.toId, sourceHandle: 'bottom', targetHandle: 'top', type: 'default', className: 'edge-sibling', style: { strokeDasharray: '2 4', strokeWidth: 1.4 } };
    }));
  }, [opts, links, tree.fields.positions, tree.fields.members, selNode, selEdge]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMember = useCallback(async (id: string, near?: { of: string; dy: number; dx: number }) => {
    const fresh = (await db.entities.get(tree.id))!;
    const m = (fresh.fields.members as string[]) ?? [];
    const p = { ...(fresh.fields.positions as Record<string, Pos>) };
    if (near && p[near.of]) p[id] = { x: p[near.of].x + near.dx, y: p[near.of].y + near.dy };
    if (!m.includes(id)) await updateEntity(tree.id, { fields: { members: [...m, id], positions: p } });
  }, [tree.id]);

  const newPerson = async (name: string) => createEntity(projectId, 'character', name);

  const relate = async (kind: 'parent' | 'child' | 'spouse' | 'sibling', otherId: string) => {
    if (!selNode) return;
    const dx = { parent: 0, child: 0, spouse: CARD_W + 50, sibling: CARD_W + 50 }[kind];
    const dy = { parent: -186, child: 186, spouse: 0, sibling: 0 }[kind];
    await addMember(otherId, { of: selNode, dx, dy });
    if (kind === 'parent') await addFamilyLink(projectId, otherId, selNode, 'parent');
    if (kind === 'child') {
      await addFamilyLink(projectId, selNode, otherId, 'parent');
      // also link the child to the selected person's current spouse/partner in this tree
      const partner = links?.find((l) => familyType(String(l.data.type)).id !== 'former-spouse' && familyType(String(l.data.type)).group === 'partner' && (l.fromId === selNode || l.toId === selNode));
      const pid = partner && (partner.fromId === selNode ? partner.toId : partner.fromId);
      if (pid && members.includes(pid)) await addFamilyLink(projectId, pid, otherId, 'parent');
    }
    if (kind === 'spouse') await addFamilyLink(projectId, selNode, otherId, 'spouse');
    if (kind === 'sibling') await addFamilyLink(projectId, selNode, otherId, 'sibling');
  };

  const autoArrange = async () => {
    if (!links) return;
    await saveDiagramPositions(tree.id, layoutFamily(members, links));
    setTimeout(() => flow.current?.fitView({ padding: 0.3, maxZoom: 1, duration: 300 }), 100);
  };

  if (!opts || !links) return null;
  const selPerson = selNode ? opts.byId.get(selNode) : undefined;
  const selLink = selEdge ? links.find((l) => l.id === selEdge) : undefined;
  const charOpts = opts.characterOpts;

  return (
    <div className="canvas-wrap">
      <div className="canvas-tools">
        <Picker options={charOpts} exclude={members} buttonLabel="Add person" placeholder="Character…" onPick={(id) => addMember(id)} onCreate={async (n) => addMember(await newPerson(n))} />
        <button className="btn ghost sm" onClick={autoArrange} title="Re-arrange automatically by generation"><Wand2 size={13} /> Auto-arrange</button>
        <span className="muted small">Drag from the bottom dot of one card to another to connect them · double-click a card to open the profile</span>
      </div>
      <div className="canvas" ref={canvasRef}>
        <ReactFlow key={flowKey} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} onInit={(inst) => { flow.current = inst; }} minZoom={0.15} maxZoom={2} proOptions={{ hideAttribution: true }}
          onNodeDragStop={async (_e, _n, moved) => {
            const fresh = (await db.entities.get(tree.id))!;
            const p = { ...(fresh.fields.positions as Record<string, Pos>) };
            for (const n of moved) p[n.id] = n.position;
            await saveDiagramPositions(tree.id, p);
          }}
          onNodeClick={(_e, n) => { setSelNode(n.id); setSelEdge(null); }}
          onEdgeClick={(_e, ed) => { setSelEdge(ed.id); setSelNode(null); }}
          onPaneClick={() => { setSelNode(null); setSelEdge(null); }}
          onConnect={(c) => setPending(c)}
          deleteKeyCode={null}>
          <Background gap={24} size={1} color="var(--border)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="var(--accent)" maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" style={{ background: 'var(--panel)' }} />
        </ReactFlow>
        {!members.length && <div className="canvas-empty"><p className="muted">Add the first person with “Add person”, then build outwards with parents, children, spouses and siblings.</p></div>}
      </div>

      {selPerson && (
        <div className="inspector">
          <div className="row gap-s"><Avatar name={selPerson.name} color={selPerson.fields.color as string | undefined} image={selPerson.fields.image as string} size={32} /><strong className="grow ellipsis">{selPerson.name}</strong><button className="icon-btn sm" onClick={() => setSelNode(null)}><X size={13} /></button></div>
          <div className="col gap-s">
            {(['parent', 'child', 'spouse', 'sibling'] as const).map((k) => (
              <div key={k} className="row gap-s">
                <span className="muted small grow">Add {k}</span>
                <Picker options={charOpts.filter((o) => o.id !== selNode)} buttonLabel="Choose" placeholder="Existing character…"
                  onPick={(id) => relate(k, id)} onCreate={async (n) => relate(k, await newPerson(n))} />
                {k === 'parent' && <button className="btn ghost sm" title="Add an unknown parent" onClick={async () => relate('parent', await createEntity(projectId, 'character', 'Unknown', { status: 'Unknown', role: 'Mentioned', treeNote: `Unknown parent of ${selPerson.name}` }))}><UserPlus size={13} /> Unknown</button>}
              </div>
            ))}
          </div>
          <label className="sfield"><span>Short description on card</span>
            <input className="input" defaultValue={String(selPerson.fields.treeNote ?? '')} key={selPerson.id} placeholder="e.g. Third duke of Varr" onBlur={(e) => updateEntity(selPerson.id, { fields: { treeNote: e.target.value } })} /></label>
          <div className="row gap-s">
            <button className="btn sm" onClick={() => openEntity(selPerson)}><ExternalLink size={13} /> Open profile</button>
            <button className="btn ghost sm" onClick={async () => {
              const fresh = (await db.entities.get(tree.id))!;
              const p = { ...(fresh.fields.positions as Record<string, Pos>) }; delete p[selPerson.id];
              await updateEntity(tree.id, { fields: { members: ((fresh.fields.members as string[]) ?? []).filter((m) => m !== selPerson.id), positions: p } });
              setSelNode(null);
            }}>Remove from tree</button>
          </div>
        </div>
      )}

      {selLink && <FamilyLinkEditor link={selLink} opts={opts} onClose={() => setSelEdge(null)} />}

      {pending && (
        <ConnectDialog a={opts.byId.get(pending.source!)!} b={opts.byId.get(pending.target!)!} onCancel={() => setPending(null)}
          onSave={async (type, swap, label) => {
            const [from, to] = swap ? [pending.target!, pending.source!] : [pending.source!, pending.target!];
            await addFamilyLink(projectId, from, to, type, label ? { label } : {});
            setPending(null);
          }} />
      )}
    </div>
  );
}

function ConnectDialog({ a, b, onCancel, onSave }: { a: Entity; b: Entity; onCancel: () => void; onSave: (type: string, swap: boolean, label: string) => void }) {
  const [type, setType] = useState('parent');
  const [swap, setSwap] = useState(false);
  const [label, setLabel] = useState('');
  if (!a || !b) return null;
  const t = familyType(type);
  const [x, y] = swap ? [b, a] : [a, b];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog">
        <h3>How are they related?</h3>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{FAMILY_TYPES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        {t.directional && (
          <div className="row gap-s"><span><strong>{x.name}</strong> is the {t.label.split(' →')[0].toLowerCase()} of <strong>{y.name}</strong></span><button className="btn ghost sm" onClick={() => setSwap(!swap)}>Swap</button></div>
        )}
        {type === 'custom' && <input className="input" placeholder="Label, e.g. godparent" value={label} onChange={(e) => setLabel(e.target.value)} />}
        <div className="row end gap-s"><button className="btn ghost" onClick={onCancel}>Cancel</button><button className="btn primary" onClick={() => onSave(type, swap, label)}>Connect</button></div>
      </div>
    </div>
  );
}

function FamilyLinkEditor({ link, opts, onClose }: { link: Link; opts: NonNullable<ReturnType<typeof useProjectOptions>>; onClose: () => void }) {
  const a = opts.byId.get(link.fromId), b = opts.byId.get(link.toId);
  const t = familyType(String(link.data.type));
  return (
    <div className="inspector">
      <div className="row gap-s"><strong className="grow">{a?.name} {t.directional ? '→' : '—'} {b?.name}</strong><button className="icon-btn sm" onClick={onClose}><X size={13} /></button></div>
      <label className="sfield"><span>Relationship</span>
        <select className="input" value={t.id} onChange={(e) => updateLinkData(link.id, { type: e.target.value })}>{FAMILY_TYPES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      {t.id === 'custom' && <label className="sfield"><span>Label</span><input className="input" defaultValue={String(link.data.label ?? '')} onBlur={(e) => updateLinkData(link.id, { label: e.target.value })} /></label>}
      <label className="sfield"><span>Notes on this connection</span>
        <textarea className="input" rows={3} defaultValue={String(link.data.note ?? '')} key={link.id} placeholder="Married in 1802; separated after the war…" onBlur={(e) => updateLinkData(link.id, { note: e.target.value })} /></label>
      <div className="row gap-s">
        {t.directional && <button className="btn ghost sm" onClick={() => db.links.update(link.id, { fromId: link.toId, toId: link.fromId })}>Swap direction</button>}
        <button className="btn ghost sm danger-text" onClick={async () => { await removeLink(link.id); onClose(); }}><Trash2 size={13} /> Remove connection</button>
      </div>
    </div>
  );
}
