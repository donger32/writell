/* The fields on a profile page (characters, worldbuilding): a ready-made layout or a hand-picked set,
   your own extra fields, and per-field remove. Fields with something written in them always show. */
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, LayoutList, Pencil, Plus, X } from 'lucide-react';
import { db, uid, type Entity, type Project } from '../../db';
import { updateEntity, type FieldDef, type LayoutChoice, type SectionDef } from '../../entities';
import { confirmDialog, openMenu, promptDialog, toast } from '../ui';
import { Field } from './common';

export interface CustomField { id: string; label: string; value: string }
export interface LayoutDef { id: string; name: string; desc: string; keys: string[] }

const keysOf = (l: LayoutChoice, layouts: LayoutDef[]) => Array.isArray(l) ? l : (layouts.find((x) => x.id === l) ?? layouts[0]).keys;
const nameOf = (l: LayoutChoice, layouts: LayoutDef[]) => Array.isArray(l) ? 'Custom' : (layouts.find((x) => x.id === l) ?? layouts[0]).name;

export function ProfileFields({ e, sections, layouts, projectKey, noun, nouns }: {
  e: Entity; sections: SectionDef[]; layouts: LayoutDef[];
  /** where the project keeps its default layout */
  projectKey: 'charLayout' | 'worldLayout';
  noun: string; nouns: string;
}) {
  const project = useLiveQuery(() => db.projects.get(e.projectId), [e.projectId]);
  const F = (k: string) => String(e.fields[k] ?? '');
  const set = (k: string, v: unknown) => updateEntity(e.id, { fields: { [k]: v } });
  const custom = (e.fields.custom as CustomField[] | undefined) ?? [];
  const projectLayout: LayoutChoice = (project as Project | undefined)?.[projectKey] ?? layouts[0].id;
  const ownLayout = e.fields.layout as LayoutChoice | undefined;
  const shownKeys = new Set(keysOf(ownLayout ?? projectLayout, layouts));
  const visible = (f: FieldDef) => shownKeys.has(f.key) || F(f.key).trim() !== '';
  const allFields = sections.flatMap((sec) => sec.fields);
  const anyVisible = allFields.some(visible) || custom.length > 0;
  const setLayout = (l: LayoutChoice | undefined) => updateEntity(e.id, { fields: { layout: l } });
  // a hand-picked list keeps fields from other layouts/types too, so switching an entry's type doesn't lose them
  const keep = (k: string) => shownKeys.has(k) || F(k).trim() !== '';
  const others = () => [...shownKeys].filter((k) => !allFields.some((f) => f.key === k));
  const hideField = async (key: string, label: string) => {
    if (F(key).trim() && !(await confirmDialog(`Remove “${label}”?`, `What you wrote in it is deleted too. (Other ${nouns} keep theirs.)`, { danger: true, ok: 'Remove' }))) return;
    const keys = [...allFields.map((f) => f.key).filter((k) => k !== key && keep(k)), ...others()];
    await updateEntity(e.id, { fields: { layout: keys, [key]: '' } });
  };
  const showField = (key: string) => updateEntity(e.id, { fields: { layout: [...allFields.map((f) => f.key).filter((k) => k === key || keep(k)), ...others()] } });
  const addFieldMenu = (ev: React.MouseEvent) => {
    const hidden = sections.flatMap((sec) => sec.fields.filter((f) => !visible(f)).map((f) => ({ f, sec: sec.title })));
    openMenu(ev, [
      ...hidden.map(({ f, sec }) => ({ label: f.label, hint: sec, icon: <Plus size={13} />, onClick: () => showField(f.key) })),
      ...(hidden.length ? [{ divider: true, label: '', onClick: () => {} }] : []),
      { label: 'Your own field…', icon: <Pencil size={13} />, onClick: async () => { const label = await promptDialog('Name of the new field (e.g. Blood type, Famous dish)', '', 'Add field'); if (label) set('custom', [...custom, { id: uid(), label, value: '' }]); } },
    ]);
  };
  const layoutMenu = (ev: React.MouseEvent) => openMenu(ev, [
    ...layouts.map((l) => ({ label: l.name, hint: l.desc, icon: <span className="menu-check">{ownLayout === l.id ? <Check size={13} /> : null}</span>, onClick: () => setLayout(l.id) })),
    { label: `Follow the project default (${nameOf(projectLayout, layouts)})`, icon: <span className="menu-check">{ownLayout === undefined ? <Check size={13} /> : null}</span>, onClick: () => setLayout(undefined) },
    { divider: true, label: '', onClick: () => {} },
    { label: `Use this layout for every ${noun} that follows the default`, icon: <LayoutList size={13} />, onClick: async () => {
      await db.projects.update(e.projectId, { [projectKey]: ownLayout ?? projectLayout } as Partial<Project>);
      await setLayout(undefined);
      toast(`Saved as the project’s default ${noun} layout`);
    } },
  ]);

  return (
    <>
      {sections.map((sec) => {
        const fields = sec.fields.filter(visible);
        if (!fields.length) return null;
        return (
          <section key={sec.title} className="psection">
            <h3>{sec.title}</h3>
            <div className={fields.every((f) => !f.long) ? 'fgrid' : 'fcol'}>
              {fields.map((f) => (
                <div key={f.key} className="field-wrap">
                  <Field label={f.label} value={F(f.key)} long={f.long} placeholder={f.placeholder} onCommit={(v) => set(f.key, v)} />
                  <button className="field-x" title={`Remove “${f.label}” from this page`} aria-label={`Remove ${f.label}`} onClick={() => hideField(f.key, f.label)}><X size={12} /></button>
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

      {!anyVisible && <p className="muted small blank-hint">This page is blank. Add only the fields you want, or pick a ready-made layout.</p>}
      <div className="row gap-s add-field-row">
        <button className="btn sm" onClick={addFieldMenu}><Plus size={13} /> Add field</button>
        <button className="btn ghost sm" onClick={layoutMenu}><LayoutList size={13} /> Layout: {ownLayout ? nameOf(ownLayout, layouts) : `${nameOf(projectLayout, layouts)} (default)`}</button>
      </div>
    </>
  );
}
