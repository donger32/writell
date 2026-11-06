import { useLiveQuery } from 'dexie-react-hooks';
import { Star, MoreHorizontal, Copy, Trash2, Plus, X, Download, LayoutList, Check, Pencil } from 'lucide-react';
import { db, uid, type Entity } from '../../db';
import { CHARACTER_LAYOUTS, CHARACTER_ROLES, CHARACTER_SECTIONS, CHARACTER_STATUS, autoColor, createEntity, deleteEntity, duplicateEntity, layoutKeys, layoutName, updateEntity, type FieldDef, type LayoutChoice } from '../../entities';
import { toastTrashed } from '../TrashView';
import { go } from '../../nav';
import { confirmDialog, openMenu, promptDialog, toast } from '../ui';
import { ColorPick, Field, ImageBox, TagEditor, useProjectOptions } from './common';
import { EntityShell, SideBox } from './EntityShell';
import { NotesAbout, RelatedEntities, SceneLinks } from './links';
import { exportEntityMarkdown } from '../../exporting';
import { CharacterTimelineBox } from '../visual/TimelineBox';

export interface CustomField { id: string; label: string; value: string }

const STATUS_COLOR: Record<string, string> = { Alive: '#5fbf8f', Dead: '#e06c75', Missing: '#e8b14a', Unknown: '#8b8d98' };

export function CharactersView({ projectId, entityId }: { projectId: string; entityId?: string }) {
  const items = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'character']).toArray(), [projectId]);
  const opts = useProjectOptions(projectId);
  if (!items || !opts) return null;
  const active = items.find((e) => e.id === entityId);
  const create = async () => {
    const name = await promptDialog('New character', '', 'Create');
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
  const custom = (e.fields.custom as CustomField[] | undefined) ?? [];
  const project = useLiveQuery(() => db.projects.get(e.projectId), [e.projectId]);
  const projectLayout = project?.charLayout ?? 'full';
  const ownLayout = e.fields.layout as LayoutChoice | undefined;
  const shownKeys = new Set(layoutKeys(ownLayout ?? projectLayout));
  // a field shows when the layout includes it, or when something is written in it
  const visible = (f: FieldDef) => shownKeys.has(f.key) || F(f.key).trim() !== '';
  const allFields = CHARACTER_SECTIONS.flatMap((sec) => sec.fields);
  const anyVisible = allFields.some(visible) || custom.length > 0;
  const setLayout = (l: LayoutChoice | undefined) => updateEntity(e.id, { fields: { layout: l } });
  const hideField = async (key: string, label: string) => {
    if (F(key).trim() && !(await confirmDialog(`Remove “${label}”?`, 'What you wrote in it is deleted too. (Other characters keep theirs.)', { danger: true, ok: 'Remove' }))) return;
    const keys = allFields.map((f) => f.key).filter((k) => k !== key && (shownKeys.has(k) || F(k).trim() !== ''));
    await updateEntity(e.id, { fields: { layout: keys, [key]: '' } });
  };
  const showField = (key: string) => {
    const keys = allFields.map((f) => f.key).filter((k) => k === key || shownKeys.has(k) || F(k).trim() !== '');
    return updateEntity(e.id, { fields: { layout: keys } });
  };
  const addFieldMenu = (ev: React.MouseEvent) => {
    const hidden = CHARACTER_SECTIONS.flatMap((sec) => sec.fields.filter((f) => !visible(f)).map((f) => ({ f, sec: sec.title })));
    openMenu(ev, [
      ...hidden.map(({ f, sec }) => ({ label: `${f.label}`, hint: sec, icon: <Plus size={13} />, onClick: () => showField(f.key) })),
      ...(hidden.length ? [{ divider: true, label: '', onClick: () => {} }] : []),
      { label: 'Your own field…', icon: <Pencil size={13} />, onClick: async () => { const label = await promptDialog('Name of the new field (e.g. Blood type, Magic affinity)', '', 'Add field'); if (label) set('custom', [...custom, { id: uid(), label, value: '' }]); } },
    ]);
  };
  const layoutMenu = (ev: React.MouseEvent) => openMenu(ev, [
    ...CHARACTER_LAYOUTS.map((l) => ({ label: l.name, hint: l.desc, icon: <span className="menu-check">{ownLayout === l.id ? <Check size={13} /> : null}</span>, onClick: () => setLayout(l.id) })),
    { label: `Follow the project default (${layoutName(projectLayout)})`, icon: <span className="menu-check">{ownLayout === undefined ? <Check size={13} /> : null}</span>, onClick: () => setLayout(undefined) },
    { divider: true, label: '', onClick: () => {} },
    { label: 'Use this layout for every character that follows the default', icon: <LayoutList size={13} />, onClick: async () => {
      await db.projects.update(e.projectId, { charLayout: ownLayout ?? projectLayout });
      await setLayout(undefined);
      toast('Saved as the project’s default character layout');
    } },
  ]);
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
              <button className="icon-btn" title="Favorite" onClick={() => updateEntity(e.id, { favorite: !e.favorite })}><Star size={16} className={e.favorite ? 'accent' : ''} fill={e.favorite ? 'currentColor' : 'none'} /></button>
              <button className="icon-btn" onClick={menu} title="More actions" aria-label="More actions"><MoreHorizontal size={16} /></button>
            </div>
            <div className="row gap-s wrap">
              <select className="pill-select" value={F('role')} onChange={(ev) => set('role', ev.target.value)}>
                <option value="">Role…</option>{CHARACTER_ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
              <select className="pill-select" value={F('status') || 'Unknown'} onChange={(ev) => set('status', ev.target.value)} style={{ color: STATUS_COLOR[F('status') || 'Unknown'] }}>
                {CHARACTER_STATUS.map((s) => <option key={s}>{s}</option>)}
              </select>
              <ColorPick value={e.fields.color as string | undefined} auto={autoColor(e.name)} onChange={(c) => set('color', c)} />
            </div>
            <TagEditor tags={e.tags} suggestions={opts.allTags} onChange={(tags) => updateEntity(e.id, { tags })} />
          </div>
        </div>

        {CHARACTER_SECTIONS.map((sec) => {
          const fields = sec.fields.filter(visible);
          if (!fields.length) return null;
          return (
            <section key={sec.title} className="psection">
              <h3>{sec.title}</h3>
              <div className={fields.every((f) => !f.long) ? 'fgrid' : 'fcol'}>
                {fields.map((f) => (
                  <div key={f.key} className="field-wrap">
                    <Field label={f.label} value={F(f.key)} long={f.long} placeholder={f.placeholder} onCommit={(v) => set(f.key, v)} />
                    <button className="field-x" title={`Remove “${f.label}” from this profile`} aria-label={`Remove ${f.label}`} onClick={() => hideField(f.key, f.label)}><X size={12} /></button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {custom.length > 0 && (
          <section className="psection">
            <h3>More</h3>
            <div className="fcol">
              {custom.map((c) => (
                <div key={c.id} className="custom-field">
                  <div className="row gap-s">
                    <input className="custom-label" defaultValue={c.label} aria-label="Field name" onBlur={(ev) => set('custom', custom.map((x) => x.id === c.id ? { ...x, label: ev.target.value || x.label } : x))} />
                    <button className="icon-btn sm" title="Remove field" onClick={async () => { if (!c.value || await confirmDialog(`Remove “${c.label}”?`, 'What you wrote in it is deleted too.', { danger: true, ok: 'Remove' })) set('custom', custom.filter((x) => x.id !== c.id)); }}><X size={12} /></button>
                  </div>
                  <Field value={c.value} long onCommit={async (v) => {
                    const fresh = ((await db.entities.get(e.id))?.fields.custom as CustomField[] | undefined) ?? [];
                    await updateEntity(e.id, { fields: { custom: fresh.map((x) => x.id === c.id ? { ...x, value: v } : x) } });
                  }} />
                </div>
              ))}
            </div>
          </section>
        )}

        {!anyVisible && <p className="muted small blank-hint">This profile is blank. Add only the fields you want, or pick a ready-made layout.</p>}
        <div className="row gap-s add-field-row">
          <button className="btn sm" onClick={addFieldMenu}><Plus size={13} /> Add field</button>
          <button className="btn ghost sm" onClick={layoutMenu}><LayoutList size={13} /> Layout: {ownLayout ? layoutName(ownLayout) : `${layoutName(projectLayout)} (default)`}</button>
        </div>
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
