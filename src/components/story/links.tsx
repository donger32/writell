import { useLiveQuery } from 'dexie-react-hooks';
import { X, FileText, StickyNote } from 'lucide-react';
import { db, type Entity } from '../../db';
import { addLink, removeLink, updateLinkData, createEntity, sideKey, sideLabel, type RefType } from '../../entities';
import { go } from '../../nav';
import { Avatar, Picker, useProjectOptions, type PickOption } from './common';

type Opts = NonNullable<ReturnType<typeof useProjectOptions>>;

export function openEntity(e: Entity) {
  const r = e.kind === 'character' ? 'characters' : e.kind === 'world' ? 'world' : 'notes';
  go({ view: r, projectId: e.projectId, entityId: e.id } as never);
}

/** Scenes linked to an entity (character appears-in / place set-in) */
export function SceneLinks({ projectId, entityId, relation, label, opts }: { projectId: string; entityId: string; relation: 'appears-in' | 'set-in'; label: string; opts: Opts }) {
  // appears-in: entity → scene; set-in: scene → entity
  const links = useLiveQuery(() => relation === 'appears-in'
    ? db.links.where('[fromType+fromId]').equals(['entity', entityId]).filter((l) => l.relation === relation).toArray()
    : db.links.where('[toType+toId]').equals(['entity', entityId]).filter((l) => l.relation === relation).toArray(), [entityId, relation]);
  if (!links) return null;
  const sceneIds = links.map((l) => (relation === 'appears-in' ? l.toId : l.fromId));
  const rows = opts.sceneOpts.filter((o) => sceneIds.includes(o.id));
  const chapterCount = new Set(opts.scenes.filter((s) => sceneIds.includes(s.id)).map((s) => s.chapterId)).size;
  return (
    <>
      {rows.length > 0 && <p className="muted small">{label} {rows.length} scene{rows.length === 1 ? '' : 's'} across {chapterCount} chapter{chapterCount === 1 ? '' : 's'}.</p>}
      <div className="linklist">
        {rows.map((o) => {
          const l = links.find((x) => (relation === 'appears-in' ? x.toId : x.fromId) === o.id)!;
          return (
            <div key={o.id} className="linkrow">
              <FileText size={13} className="muted" />
              <button className="link grow ellipsis" onClick={() => go({ view: 'write', projectId, sceneId: o.id })}>{o.label}</button>
              <button className="icon-btn sm" title="Remove link" onClick={() => removeLink(l.id)}><X size={12} /></button>
            </div>
          );
        })}
      </div>
      <Picker options={opts.sceneOpts} exclude={sceneIds} buttonLabel="Link scene" placeholder="Find a scene…"
        onPick={(sid) => relation === 'appears-in' ? addLink(projectId, 'entity', entityId, 'scene', sid, relation) : addLink(projectId, 'scene', sid, 'entity', entityId, relation)} />
    </>
  );
}

/** Two-way 'related' links between entities, each with an editable label */
export function RelatedEntities({ projectId, entityId, kinds, options, opts, labelPlaceholder, createKind, buttonLabel }: {
  projectId: string; entityId: string; kinds: string[]; options: PickOption[]; opts: Opts; labelPlaceholder: string; createKind?: 'character' | 'world'; buttonLabel: string;
}) {
  const links = useLiveQuery(async () => {
    const a = await db.links.where('[fromType+fromId]').equals(['entity', entityId]).filter((l) => l.relation === 'related' && l.toType === 'entity').toArray();
    const b = await db.links.where('[toType+toId]').equals(['entity', entityId]).filter((l) => l.relation === 'related' && l.fromType === 'entity').toArray();
    return [...a, ...b];
  }, [entityId]);
  if (!links) return null;
  const rows = links.map((l) => ({ l, other: opts.byId.get(l.fromId === entityId ? l.toId : l.fromId) })).filter((r) => r.other && kinds.includes(r.other.kind));
  const otherIds = rows.map((r) => r.other!.id);
  return (
    <>
      <div className="linklist">
        {rows.map(({ l, other }) => (
          <div key={l.id} className="linkrow">
            {other!.kind === 'character' ? <Avatar name={other!.name} color={other!.fields.color as string | undefined} image={other!.fields.image as string} size={22} /> : <span className="kind-dot" />}
            <button className="link ellipsis" style={{ maxWidth: '45%' }} onClick={() => openEntity(other!)}>{other!.name}</button>
            <input className="link-label" placeholder={labelPlaceholder} title={`How ${opts.byId.get(entityId)?.name ?? 'this'} relates to ${other!.name}`} defaultValue={sideLabel(l, entityId)} onBlur={(e) => updateLinkData(l.id, { [sideKey(l, entityId)]: e.target.value })} />
            <button className="icon-btn sm" title="Remove link" onClick={() => removeLink(l.id)}><X size={12} /></button>
          </div>
        ))}
      </div>
      <Picker options={options.filter((o) => o.id !== entityId)} exclude={otherIds} buttonLabel={buttonLabel}
        onPick={(id) => addLink(projectId, 'entity', entityId, 'entity', id, 'related')}
        onCreate={createKind ? async (name) => { const id = await createEntity(projectId, createKind, name); await addLink(projectId, 'entity', entityId, 'entity', id, 'related'); } : undefined} />
    </>
  );
}

/** Notes that point at this thing */
export function NotesAbout({ projectId, type, id }: { projectId: string; type: RefType; id: string }) {
  const notes = useLiveQuery(async () => {
    const ls = await db.links.where('[toType+toId]').equals([type, id]).filter((l) => l.relation === 'about').toArray();
    return (await db.entities.bulkGet(ls.map((l) => l.fromId))).filter(Boolean) as Entity[];
  }, [type, id]);
  if (!notes) return null;
  return (
    <div className="linklist">
      {notes.map((n) => (
        <div key={n.id} className="linkrow">
          <StickyNote size={13} className="muted" />
          <button className="link grow ellipsis" onClick={() => go({ view: 'notes', projectId, entityId: n.id })}>{n.name || 'Untitled note'}</button>
        </div>
      ))}
      {!notes.length && <p className="muted small">No notes linked yet. In Notes, use “Linked to” to attach one.</p>}
    </div>
  );
}

/** Characters and places attached to a scene (shown in the scene details drawer) */
export function SceneStoryLinks({ projectId, sceneId }: { projectId: string; sceneId: string }) {
  const opts = useProjectOptions(projectId);
  const chars = useLiveQuery(() => db.links.where('[toType+toId]').equals(['scene', sceneId]).filter((l) => l.relation === 'appears-in').toArray(), [sceneId]);
  const places = useLiveQuery(() => db.links.where('[fromType+fromId]').equals(['scene', sceneId]).filter((l) => l.relation === 'set-in').toArray(), [sceneId]);
  if (!opts || !chars || !places) return null;
  const row = (l: { id: string }, e: Entity | undefined) => e && (
    <span key={l.id} className="linkchip">
      {e.kind === 'character' && <Avatar name={e.name} color={e.fields.color as string | undefined} image={e.fields.image as string} size={18} />}
      <button className="link" onClick={() => openEntity(e)}>{e.name}</button>
      <button aria-label="Unlink" onClick={() => removeLink(l.id)}><X size={11} /></button>
    </span>
  );
  return (
    <>
      <div className="field"><div className="row"><span className="grow muted small">Characters in this scene</span>
        <Picker options={opts.characterOpts} exclude={chars.map((l) => l.fromId)} buttonLabel="Add"
          onPick={(id) => addLink(projectId, 'entity', id, 'scene', sceneId, 'appears-in')}
          onCreate={async (name) => { const id = await createEntity(projectId, 'character', name, { status: 'Alive', role: 'Supporting' }); await addLink(projectId, 'entity', id, 'scene', sceneId, 'appears-in'); }} />
      </div>
        <div className="chips">{chars.map((l) => row(l, opts.byId.get(l.fromId)))}{!chars.length && <span className="muted small">None yet</span>}</div>
      </div>
      <div className="field"><div className="row"><span className="grow muted small">Setting</span>
        <Picker options={opts.placeOpts} exclude={places.map((l) => l.toId)} buttonLabel="Add"
          onPick={(id) => addLink(projectId, 'scene', sceneId, 'entity', id, 'set-in')}
          onCreate={async (name) => { const id = await createEntity(projectId, 'world', name, { category: 'Location' }); await addLink(projectId, 'scene', sceneId, 'entity', id, 'set-in'); }} />
      </div>
        <div className="chips">{places.map((l) => row(l, opts.byId.get(l.toId)))}{!places.length && <span className="muted small">None yet</span>}</div>
      </div>
    </>
  );
}
