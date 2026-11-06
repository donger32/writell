import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, FileText, Folder, Globe, GitBranch, Heart, Map, RotateCcw, StickyNote, Trash2, Users, CalendarRange, Network } from 'lucide-react';
import { db, type TrashItem } from '../db';
import { deleteForever, emptyTrash, restoreTrash } from '../trash';
import { timeAgo } from '../util';
import { confirmDialog, toast } from './ui';

const KIND_LABEL: Record<string, string> = {
  project: 'Project', chapter: 'Chapter', scene: 'Scene', character: 'Character', world: 'Worldbuilding', note: 'Note',
  map: 'Map', familytree: 'Family tree', relmap: 'Relationship map', timeline: 'Timeline', event: 'Timeline event',
};
const KIND_ICON: Record<string, typeof Folder> = {
  project: Folder, chapter: BookOpen, scene: FileText, character: Users, world: Globe, note: StickyNote,
  map: Map, familytree: GitBranch, relmap: Network, timeline: CalendarRange, event: CalendarRange, relationship: Heart,
};

/** Restore with feedback; used by the Trash page and by "Undo" after a delete */
export async function restoreWithToast(id: string) {
  const r = await restoreTrash(id);
  if (r.ok) toast(`Restored “${r.item.name}”`);
  else toast(r.reason);
  return r.ok;
}

/** Show "X moved to the trash · Undo" after a delete */
export function toastTrashed(name: string, trashId: string | undefined) {
  if (!trashId) { toast(`Deleted “${name}”`); return; }
  toast(`“${name}” moved to the trash`, { label: 'Undo', run: () => restoreWithToast(trashId) });
}

function count(it: TrashItem) {
  const r = it.rows;
  const bits: string[] = [];
  if (it.kind === 'project' || it.kind === 'chapter') { const n = r.scenes?.length ?? 0; if (n) bits.push(`${n} scene${n > 1 ? 's' : ''}`); }
  if (it.kind === 'project') { const n = (r.entities ?? []).filter((e) => (e as { kind: string }).kind === 'character').length; if (n) bits.push(`${n} character${n > 1 ? 's' : ''}`); }
  if (it.kind === 'timeline') { const n = (r.entities ?? []).filter((e) => (e as { kind: string }).kind === 'event').length; if (n) bits.push(`${n} event${n > 1 ? 's' : ''}`); }
  const links = r.links?.length ?? 0;
  if (links && it.kind !== 'project') bits.push(`${links} connection${links > 1 ? 's' : ''}`);
  return bits.join(' · ');
}

export function TrashView() {
  const items = useLiveQuery(() => db.trash.orderBy('deletedAt').reverse().toArray(), []);
  if (!items) return null;
  return (
    <div className="page trash-page">
      <header className="page-head">
        <div>
          <h1>Trash</h1>
          <p className="muted">Deleted things wait here until you remove them for good. Restoring puts back their links, family-tree spots and timeline entries too.</p>
        </div>
        {items.length > 0 && <button className="btn danger-text" onClick={async () => {
          if (await confirmDialog(`Empty the trash?`, `${items.length} item${items.length > 1 ? 's are' : ' is'} removed for good. This can’t be undone.`, { danger: true, ok: 'Empty trash' })) { await emptyTrash(); toast('Trash emptied'); }
        }}><Trash2 size={14} /> Empty trash</button>}
      </header>
      {items.length === 0 ? (
        <div className="empty-card">
          <Trash2 size={22} className="muted" />
          <h3>The trash is empty</h3>
          <p className="muted">When you delete a character, place, chapter or project, it comes here first.</p>
        </div>
      ) : (
        <ul className="trash-list">
          {items.map((it) => {
            const Icon = KIND_ICON[it.kind] ?? FileText;
            const extra = count(it);
            return (
              <li key={it.id} className="trash-row">
                <span className="trash-ic"><Icon size={16} /></span>
                <div className="grow">
                  <div className="trash-name ellipsis">{it.name || 'Untitled'}</div>
                  <div className="muted small ellipsis">{KIND_LABEL[it.kind] ?? it.kind}{it.kind !== 'project' && it.projectTitle ? ` · in ${it.projectTitle}` : ''}{extra ? ` · ${extra}` : ''} · deleted {timeAgo(it.deletedAt)}</div>
                </div>
                <button className="btn sm" onClick={() => restoreWithToast(it.id)}><RotateCcw size={13} /> Restore</button>
                <button className="icon-btn" title="Delete forever" aria-label={`Delete ${it.name} forever`} onClick={async () => {
                  if (await confirmDialog(`Delete “${it.name}” forever?`, 'This can’t be undone.', { danger: true, ok: 'Delete forever' })) deleteForever(it.id);
                }}><Trash2 size={14} /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
