import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Star, MoreHorizontal, Copy, Trash2, Plus, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { db, now, type Entity } from '../../db';
import { ProfileFields } from './ProfileFields';
import { CHARACTER_LAYOUTS, CHARACTER_ROLES, CHARACTER_SECTIONS, CHARACTER_STATUS, autoColor, createEntity, deleteEntity, duplicateEntity, updateEntity } from '../../entities';
import { toastTrashed } from '../TrashView';
import { go } from '../../nav';
import { Modal, NameDice, confirmDialog, openMenu, promptDialog, toast } from '../ui';
import { ColorPick, Field, ImageBox, TagEditor, useProjectOptions } from './common';
import { EntityShell, SideBox } from './EntityShell';
import { NotesAbout, RelatedEntities, SceneLinks } from './links';
import { exportEntityMarkdown } from '../../exporting';
import { CharacterTimelineBox } from '../visual/TimelineBox';

export type { CustomField } from './ProfileFields';

const STATUS_COLOR: Record<string, string> = { Alive: '#5fbf8f', Dead: '#e06c75', Missing: '#e8b14a', Unknown: '#8b8d98' };

export function CharactersView({ projectId, entityId }: { projectId: string; entityId?: string }) {
  const items = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'character']).toArray(), [projectId]);
  const opts = useProjectOptions(projectId);
  if (!items || !opts) return null;
  const active = items.find((e) => e.id === entityId);
  const create = async () => {
    const name = await promptDialog('New character', '', 'Create', { names: true });
    if (!name) return;
    const id = await createEntity(projectId, 'character', name, { status: 'Alive', role: 'Supporting' });
    go({ view: 'characters', projectId, entityId: id });
  };
  return (
    <EntityShell title="Character" items={items} activeId={entityId} onOpen={(id) => go({ view: 'characters', projectId, entityId: id })}
      onNew={create} newLabel="Character"
      renderSub={(e) => [e.fields.role, e.fields.status !== 'Alive' ? e.fields.status : '', e.fields.age ? `age ${e.fields.age}` : ''].filter(Boolean).join(' · ')}
      empty={<><h3>Your cast</h3><p className="muted">{items.length ? 'Pick a character on the left.' : 'Create your first character. Profiles can link to scenes, places and other characters.'}</p><button className="btn primary" onClick={create}><Plus size={14} /> New character</button></>}>
      {active && <CharacterProfile key={active.id} e={active} opts={opts} />}
    </EntityShell>
  );
}

function CharacterProfile({ e, opts }: { e: Entity; opts: NonNullable<ReturnType<typeof useProjectOptions>> }) {
  const F = (k: string) => String(e.fields[k] ?? '');
  const set = (k: string, v: unknown) => updateEntity(e.id, { fields: { [k]: v } });
  const project = useLiveQuery(() => db.projects.get(e.projectId), [e.projectId]);
  const roles = project?.charRoles ?? CHARACTER_ROLES;
  const [editRoles, setEditRoles] = useState(false);
  const menu = (ev: React.MouseEvent) => openMenu(ev, [
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: async () => { const id = await duplicateEntity(e.id); if (id) go({ view: 'characters', projectId: e.projectId, entityId: id }); } },
    { label: 'Export profile (.md)', icon: <Download size={14} />, onClick: () => exportEntityMarkdown(e.id) },
    { divider: true, label: '', onClick: () => {} },
    { label: 'Delete character', danger: true, icon: <Trash2 size={14} />, onClick: async () => {
      go({ view: 'characters', projectId: e.projectId }); toastTrashed(e.name, await deleteEntity(e.id));
    } },
  ]);

  return (
    <div className="profile">
      <div className="profile-main">
        <div className="profile-head">
          <ImageBox image={e.fields.image as string | undefined} name={e.name} color={e.fields.color as string | undefined} round onChange={(v) => set('image', v ?? undefined)} size={104} />
          <div className="col gap-s grow" style={{ minWidth: 0 }}>
            <div className="row gap-s">
              <Field wrap className="name-field grow" value={e.name} onCommit={(v) => updateEntity(e.id, { name: v || 'Unnamed' })} />
              <NameDice onName={(n) => { const old = e.name; updateEntity(e.id, { name: n }); toast(`Renamed to ${n}`, { label: `Undo`, run: () => updateEntity(e.id, { name: old }) }); }} />
              <button className="icon-btn" title="Favorite" onClick={() => updateEntity(e.id, { favorite: !e.favorite })}><Star size={16} className={e.favorite ? 'accent' : ''} fill={e.favorite ? 'currentColor' : 'none'} /></button>
              <button className="icon-btn" onClick={menu} title="More actions" aria-label="More actions"><MoreHorizontal size={16} /></button>
            </div>
            <div className="row gap-s wrap">
              <select className="pill-select" value={F('role')} onChange={(ev) => { if (ev.target.value === '\u0000edit') setEditRoles(true); else set('role', ev.target.value); }}>
                <option value="">Role…</option>
                {roles.map((r) => <option key={r}>{r}</option>)}
                {F('role') && !roles.includes(F('role')) && <option>{F('role')}</option>}
                <option disabled>──────────</option>
                <option value={'\u0000edit'}>Edit roles…</option>
              </select>
              {editRoles && <ManageRoles projectId={e.projectId} roles={roles} onClose={() => setEditRoles(false)} />}
              <select className="pill-select" value={F('status') || 'Unknown'} onChange={(ev) => set('status', ev.target.value)} style={{ color: STATUS_COLOR[F('status') || 'Unknown'] }}>
                {CHARACTER_STATUS.map((s) => <option key={s}>{s}</option>)}
              </select>
              <ColorPick value={e.fields.color as string | undefined} auto={autoColor(e.name)} onChange={(c) => set('color', c)} />
            </div>
            <TagEditor tags={e.tags} suggestions={opts.allTags} onChange={(tags) => updateEntity(e.id, { tags })} />
          </div>
        </div>

        <ProfileFields e={e} sections={CHARACTER_SECTIONS} layouts={CHARACTER_LAYOUTS} projectKey="charLayout" noun="character" nouns="characters" />
      </div>

      <aside className="profile-side">
        <SideBox title="On the timeline"><CharacterTimelineBox c={e} /></SideBox>
        <SideBox title="Appears in"><SceneLinks projectId={e.projectId} entityId={e.id} relation="appears-in" label="Appears in" opts={opts} /></SideBox>
        <SideBox title="Relationships"><RelatedEntities projectId={e.projectId} entityId={e.id} kinds={['character']} options={opts.characterOpts} opts={opts} labelPlaceholder="e.g. sister, rival" createKind="character" buttonLabel="Add character" /></SideBox>
        <SideBox title="Places & world"><RelatedEntities projectId={e.projectId} entityId={e.id} kinds={['world']} options={opts.worldOpts} opts={opts} labelPlaceholder="e.g. hometown, member" createKind="world" buttonLabel="Link entry" /></SideBox>
        <SideBox title="Notes"><NotesAbout projectId={e.projectId} type="entity" id={e.id} /></SideBox>
      </aside>
    </div>
  );
}

/** Add, rename, reorder and remove the project's character roles */
function ManageRoles({ projectId, roles, onClose }: { projectId: string; roles: string[]; onClose: () => void }) {
  const [v, setV] = useState('');
  const cast = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'character']).toArray(), [projectId]) ?? [];
  const count = (r: string) => cast.filter((c) => c.fields.role === r).length;
  const save = (list: string[]) => db.projects.update(projectId, { charRoles: [...new Set(list)], updatedAt: now() });
  const add = async () => { const r = v.trim(); if (!r) return; if (!roles.includes(r)) await save([...roles, r]); setV(''); };
  const rename = async (from: string, raw: string) => {
    const to = raw.trim();
    if (!to || to === from) return;
    for (const c of cast) if (c.fields.role === from) await updateEntity(c.id, { fields: { role: to } });
    await save(roles.map((x) => x === from ? to : x));
    toast(`“${from}” is now “${to}”`);
  };
  const remove = async (r: string) => {
    const n = count(r);
    if (n && !(await confirmDialog(`Remove “${r}”?`, `${n} ${n === 1 ? 'character has' : 'characters have'} this role and will have none. The characters themselves are kept.`, { danger: true, ok: 'Remove' }))) return;
    for (const c of cast) if (c.fields.role === r) await updateEntity(c.id, { fields: { role: '' } });
    await save(roles.filter((x) => x !== r));
  };
  const move = (i: number, d: number) => { const l = [...roles]; [l[i], l[i + d]] = [l[i + d], l[i]]; void save(l); };
  return (
    <Modal title="Character roles" onClose={onClose}>
      <div className="col gap-s manage-tags">
        <div className="row gap-s">
          <input className="input grow" autoFocus value={v} placeholder="New role, e.g. Mentor" onChange={(ev) => setV(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') void add(); }} />
          <button className="btn primary sm" onClick={() => void add()} disabled={!v.trim()}><Plus size={13} /> Add</button>
        </div>
        {!roles.length && <p className="muted small">No roles yet. Add the ones your story needs.</p>}
        <div className="tag-rows">
          {roles.map((r, i) => (
            <div key={r} className="tag-row">
              <input className="tag-name" defaultValue={r} aria-label={`Rename ${r}`} onBlur={(ev) => void rename(r, ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
              <span className="muted small">{count(r)} {count(r) === 1 ? 'character' : 'characters'}</span>
              <button className="icon-btn sm" title="Move up" aria-label={`Move ${r} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
              <button className="icon-btn sm" title="Move down" aria-label={`Move ${r} down`} disabled={i === roles.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
              <button className="icon-btn sm" title={`Remove ${r}`} aria-label={`Remove ${r}`} onClick={() => void remove(r)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <p className="muted small">Click a name to rename it for every character who has it.</p>
      </div>
    </Modal>
  );
}
