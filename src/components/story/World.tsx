import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Star, MoreHorizontal, Copy, Trash2, Plus, Download } from 'lucide-react';
import { db, type Entity } from '../../db';
import { WORLD_CATEGORIES, PLACE_CATEGORIES, createEntity, deleteEntity, duplicateEntity, updateEntity, worldSections, parentOf, setParent, ancestors, isInside, childCategory } from '../../entities';
import { toastTrashed } from '../TrashView';
import { ChevronRight, X } from 'lucide-react';
import { Picker } from './common';
import { go } from '../../nav';
import { openMenu, promptDialog, toast } from '../ui';
import { Field, ImageBox, TagEditor, useProjectOptions } from './common';
import { EntityShell, SideBox } from './EntityShell';
import { NotesAbout, RelatedEntities, SceneLinks } from './links';
import { exportEntityMarkdown } from '../../exporting';
import { TimelineBox } from '../visual/TimelineBox';

const GROUPS = [...new Set(WORLD_CATEGORIES.map((c) => c.group))];

export function WorldView({ projectId, entityId, category }: { projectId: string; entityId?: string; category?: string }) {
  const items = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'world']).toArray(), [projectId]);
  const opts = useProjectOptions(projectId);
  const [filter, setFilter] = useState<string>(category ?? 'All');
  if (!items || !opts) return null;
  const active = items.find((e) => e.id === entityId);
  const customCats = [...new Set(items.map((e) => String(e.fields.category ?? '')).filter((c) => c && !WORLD_CATEGORIES.some((w) => w.name === c)))];
  const usedCats = [...new Set(items.map((e) => String(e.fields.category ?? '')))].filter(Boolean).sort();
  const shown = filter === 'All' ? items : filter === 'Places' ? items.filter((e) => PLACE_CATEGORIES.has(String(e.fields.category))) : items.filter((e) => e.fields.category === filter);

  const create = async () => {
    const name = await promptDialog('New worldbuilding entry', '', 'Create');
    if (!name) return;
    const cat = filter !== 'All' && filter !== 'Places' ? filter : filter === 'Places' ? 'Location' : 'Location';
    const id = await createEntity(projectId, 'world', name, { category: cat });
    go({ view: 'world', projectId, entityId: id });
  };
  return (
    <EntityShell title="Worldbuilding" items={shown} activeId={entityId} round={false} onOpen={(id) => go({ view: 'world', projectId, entityId: id })}
      parentOf={parentOf} onNest={async (id, parent) => { try { await setParent(id, parent); } catch (err) { toast((err as Error).message); } }}
      onNew={create} newLabel="Entry" renderSub={(e) => String(e.fields.category ?? '')}
      filters={
        <div className="filter-chips">
          {['All', 'Places', ...usedCats].map((c) => <button key={c} className={'chip' + (filter === c ? ' on' : '')} onClick={() => setFilter(c)}>{c}</button>)}
        </div>
      }
      empty={<><h3>Your world</h3><p className="muted">Places, factions, religions, magic systems, species, languages, artifacts… Each entry can link to characters, scenes and other entries.</p><button className="btn primary" onClick={create}><Plus size={14} /> New entry</button></>}>
      {active && <WorldEntry key={active.id} e={active} opts={opts} customCats={customCats} all={items} />}
    </EntityShell>
  );
}

function WorldEntry({ e, opts, customCats, all }: { e: Entity; opts: NonNullable<ReturnType<typeof useProjectOptions>>; customCats: string[]; all: Entity[] }) {
  const byId = new Map(all.map((x) => [x.id, x]));
  const chain = ancestors(e, byId).reverse();
  const children = all.filter((x) => parentOf(x) === e.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const open = (id: string) => go({ view: 'world', projectId: e.projectId, entityId: id });
  const nest = async (id: string, parent: string | undefined) => { try { await setParent(id, parent); } catch (err) { toast((err as Error).message); } };
  const cat = String(e.fields.category ?? 'Location');
  const F = (k: string) => String(e.fields[k] ?? '');
  const set = (k: string, v: unknown) => updateEntity(e.id, { fields: { [k]: v } });
  const isPlace = PLACE_CATEGORIES.has(cat);
  const menu = (ev: React.MouseEvent) => openMenu(ev, [
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: async () => { const id = await duplicateEntity(e.id); if (id) go({ view: 'world', projectId: e.projectId, entityId: id }); } },
    { label: 'Export entry (.md)', icon: <Download size={14} />, onClick: () => exportEntityMarkdown(e.id) },
    { divider: true, label: '', onClick: () => {} },
    { label: 'Delete entry', danger: true, icon: <Trash2 size={14} />, onClick: async () => {
      go({ view: 'world', projectId: e.projectId }); toastTrashed(e.name, await deleteEntity(e.id));
    } },
  ]);
  return (
    <div className="profile">
      <div className="profile-main">
        {chain.length > 0 && (
          <nav className="breadcrumb" aria-label="Part of">
            {chain.map((a) => <span key={a.id} className="row"><button className="link" onClick={() => open(a.id)}>{a.name}</button><ChevronRight size={12} className="muted" /></span>)}
            <span className="muted">{e.name}</span>
          </nav>
        )}
        <div className="profile-head">
          <ImageBox image={e.fields.image as string | undefined} name={e.name} onChange={(v) => set('image', v ?? undefined)} size={104} />
          <div className="col gap-s grow" style={{ minWidth: 0 }}>
            <div className="row gap-s">
              <Field wrap className="name-field grow" value={e.name} onCommit={(v) => updateEntity(e.id, { name: v || 'Untitled' })} />
              <button className="icon-btn" title="Favorite" onClick={() => updateEntity(e.id, { favorite: !e.favorite })}><Star size={16} className={e.favorite ? 'accent' : ''} fill={e.favorite ? 'currentColor' : 'none'} /></button>
              <button className="icon-btn" onClick={menu} title="More actions" aria-label="More actions"><MoreHorizontal size={16} /></button>
            </div>
            <div className="row gap-s wrap">
              <select className="pill-select" value={cat} onChange={async (ev) => {
                let v = ev.target.value;
                if (v === '__new') { const n = await promptDialog('New category', '', 'Create'); if (!n) return; v = n; }
                set('category', v);
              }}>
                {GROUPS.map((g) => <optgroup key={g} label={g}>{WORLD_CATEGORIES.filter((c) => c.group === g).map((c) => <option key={c.name}>{c.name}</option>)}</optgroup>)}
                {customCats.length > 0 && <optgroup label="Your categories">{customCats.map((c) => <option key={c}>{c}</option>)}</optgroup>}
                {!WORLD_CATEGORIES.some((c) => c.name === cat) && !customCats.includes(cat) && <option>{cat}</option>}
                <option value="__new">+ New category…</option>
              </select>
            </div>
            <TagEditor tags={e.tags} suggestions={opts.allTags} onChange={(tags) => updateEntity(e.id, { tags })} />
          </div>
        </div>
        {worldSections(cat).map((sec) => (
          <section key={sec.title} className="psection">
            <h3>{sec.title}</h3>
            <div className={sec.fields.every((f) => !f.long) ? 'fgrid' : 'fcol'}>
              {sec.fields.map((f) => <Field key={f.key} label={sec.fields.length > 1 ? f.label : undefined} value={F(f.key)} long={f.long} onCommit={(v) => set(f.key, v)} />)}
            </div>
          </section>
        ))}
      </div>
      <aside className="profile-side">
        <SideBox title="Part of">
          {parentOf(e) && byId.get(parentOf(e)!) ? (
            <div className="linkrow"><span className="kind-dot" /><button className="link grow ellipsis" onClick={() => open(parentOf(e)!)}>{byId.get(parentOf(e)!)!.name}</button>
              <span className="muted small">{String(byId.get(parentOf(e)!)!.fields.category ?? '')}</span>
              <button className="icon-btn sm" title="Not part of anything" onClick={() => nest(e.id, undefined)}><X size={12} /></button></div>
          ) : <p className="muted small">Not inside another place. E.g. put a city inside its region or country.</p>}
          <Picker options={opts.worldOpts.filter((o) => !isInside(o.id, e, all))} buttonLabel={parentOf(e) ? 'Move' : 'Choose'} placeholder="Bigger place…"
            onPick={(id) => nest(e.id, id)}
            onCreate={async (n) => { const id = await createEntity(e.projectId, 'world', n, { category: 'Region' }); await nest(e.id, id); }} />
        </SideBox>
        <SideBox title={`Contains${children.length ? ` (${children.length})` : ''}`}>
          <div className="linklist">
            {children.map((c) => (
              <div key={c.id} className="linkrow"><span className="kind-dot" /><button className="link grow ellipsis" onClick={() => open(c.id)}>{c.name}</button>
                <span className="muted small">{String(c.fields.category ?? '')}</span>
                <button className="icon-btn sm" title={`Take ${c.name} out of ${e.name}`} onClick={() => nest(c.id, parentOf(e))}><X size={12} /></button></div>
            ))}
          </div>
          {!children.length && <p className="muted small">Add the regions, cities, districts or buildings that are part of {e.name}. You can also drag entries onto each other in the list.</p>}
          <Picker options={opts.worldOpts.filter((o) => o.id !== e.id && !ancestors(e, byId).some((a) => a.id === o.id) && parentOf(byId.get(o.id)!) !== e.id)} buttonLabel="Add" placeholder="Existing entry, or type a new name…"
            onPick={(id) => nest(id, e.id)}
            onCreate={async (n) => { const id = await createEntity(e.projectId, 'world', n, { category: childCategory(cat), parentId: e.id }); toast(`${n} added inside ${e.name}`); void id; }} />
        </SideBox>
        <SideBox title="On the timeline"><TimelineBox projectId={e.projectId} kind="world" id={e.id} name={e.name} involve={[e.id]} /></SideBox>
        <SideBox title="Characters"><RelatedEntities projectId={e.projectId} entityId={e.id} kinds={['character']} options={opts.characterOpts} opts={opts} labelPlaceholder={isPlace ? 'e.g. lives here' : 'e.g. member, founder'} createKind="character" buttonLabel="Add character" /></SideBox>
        {isPlace && <SideBox title="Scenes set here"><SceneLinks projectId={e.projectId} entityId={e.id} relation="set-in" label="Setting of" opts={opts} /></SideBox>}
        <SideBox title="Related entries"><RelatedEntities projectId={e.projectId} entityId={e.id} kinds={['world']} options={opts.worldOpts} opts={opts} labelPlaceholder="e.g. capital of, part of" createKind="world" buttonLabel="Link entry" /></SideBox>
        <SideBox title="Notes"><NotesAbout projectId={e.projectId} type="entity" id={e.id} /></SideBox>
      </aside>
    </div>
  );
}
