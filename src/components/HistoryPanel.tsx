import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { X, GitCompare } from 'lucide-react';
import { diffWords } from 'diff';
import { db, type Snapshot } from '../db';
import { jsonToText } from '../editor/extensions';
import { fmtNum, timeAgo } from '../util';
import { Modal, confirmDialog } from './ui';

const REASON = { auto: 'Autosave', manual: 'Snapshot', 'before-restore': 'Before restore', 'before-raw-edit': 'Before Markdown edit', 'before-sync': 'Before sync (other device’s version replaced it)' };
const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function HistoryPanel({ sceneId, onRestore, onSnapshot, onClose, getCurrent }: { sceneId: string; onRestore: (c: unknown) => void; onSnapshot: () => void; onClose: () => void; getCurrent: () => unknown }) {
  const snaps = useLiveQuery(() => db.snapshots.where('[sceneId+createdAt]').between([sceneId, 0], [sceneId, Infinity]).reverse().toArray(), [sceneId]);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [compare, setCompare] = useState<{ a: Snapshot | 'current'; b: Snapshot | 'current' } | null>(null);
  const [pickB, setPickB] = useState<Snapshot | null>(null);
  return (
    <div className="drawer">
      <div className="drawer-head"><h4>Revision history</h4><button className="icon-btn sm" onClick={onClose}><X size={14} /></button></div>
      <p className="muted small">A copy is saved automatically every 5 minutes while you write (last 50 kept), plus whenever you take a snapshot. Click a version to preview it; compare any two.</p>
      <button className="btn sm" onClick={onSnapshot}>Take snapshot now</button>
      <div className="snap-list">
        {snaps?.length === 0 && <p className="muted small">No saved versions yet.</p>}
        {snaps?.map((s) => (
          <button key={s.id} className={'snap' + (preview?.id === s.id ? ' on' : '') + (pickB?.id === s.id ? ' pick' : '')} onClick={() => setPreview(preview?.id === s.id ? null : s)}>
            <span>{when(s.createdAt)}</span>
            <span className="muted small">{REASON[s.reason]} · {fmtNum(s.words)} words · {timeAgo(s.createdAt)}</span>
          </button>
        ))}
      </div>
      {preview && (
        <div className="snap-preview">
          <div className="snap-text">{jsonToText(preview.content).slice(0, 4000) || <em className="muted">(empty)</em>}</div>
          <div className="row gap-s wrap">
            <button className="btn sm" onClick={() => setCompare({ a: preview, b: 'current' })}><GitCompare size={13} /> Compare with now</button>
            {pickB && pickB.id !== preview.id
              ? <button className="btn sm" onClick={() => { setCompare(pickB.createdAt < preview.createdAt ? { a: pickB, b: preview } : { a: preview, b: pickB }); setPickB(null); }}>Compare with marked</button>
              : <button className="btn ghost sm" onClick={() => setPickB(preview)}>Mark for comparison</button>}
            <button className="btn primary sm" onClick={async () => {
              if (await confirmDialog('Restore this version?', 'The current text is saved to history first, so you can undo this.', { ok: 'Restore' })) { onRestore(preview.content); setPreview(null); }
            }}>Restore</button>
          </div>
        </div>
      )}
      {compare && <CompareModal a={compare.a} b={compare.b} current={getCurrent()} onClose={() => setCompare(null)} />}
    </div>
  );
}

function CompareModal({ a, b, current, onClose }: { a: Snapshot | 'current'; b: Snapshot | 'current'; current: unknown; onClose: () => void }) {
  const text = (x: Snapshot | 'current') => jsonToText(x === 'current' ? current : x.content);
  const label = (x: Snapshot | 'current') => (x === 'current' ? 'Now' : when(x.createdAt));
  const parts = diffWords(text(a), text(b));
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.value.match(/\S+/g)?.length ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.value.match(/\S+/g)?.length ?? 0), 0);
  return (
    <Modal title="Compare versions" wide onClose={onClose}>
      <div className="pad col gap-s" style={{ overflow: 'auto' }}>
        <div className="row gap wrap small"><span><span className="diff-del">{label(a)}</span> → <span className="diff-add">{label(b)}</span></span><span className="muted">+{fmtNum(added)} words added · −{fmtNum(removed)} removed</span></div>
        <div className="diff">{parts.map((p, i) => <span key={i} className={p.added ? 'diff-add' : p.removed ? 'diff-del' : ''}>{p.value}</span>)}</div>
      </div>
    </Modal>
  );
}
