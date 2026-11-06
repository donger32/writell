import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { FileText, FileType, FileDown, Printer } from 'lucide-react';
import { db } from '../db';
import { DEFAULT_EXPORT, MANUSCRIPT_PRESET, exportManuscript, pdfHint, type ExportOptions } from '../manuscript';
import { Modal, toast } from './ui';

const FORMATS = [
  { id: 'docx', label: 'Word', ext: '.docx', icon: FileType },
  { id: 'pdf', label: 'PDF', ext: 'print', icon: Printer },
  { id: 'md', label: 'Markdown', ext: '.md', icon: FileDown },
  { id: 'txt', label: 'Plain text', ext: '.txt', icon: FileText },
] as const;

export function ExportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('order'), [projectId]);
  const [fmt, setFmt] = useState<'docx' | 'pdf' | 'md' | 'txt'>('docx');
  const [o, setO] = useState<ExportOptions | null>(null);
  const [busy, setBusy] = useState(false);
  if (!project || !chapters) return null;
  const opts: ExportOptions = o ?? { ...DEFAULT_EXPORT, author: project.author ?? '', ...(project.exportOptions as Partial<ExportOptions>), chapterIds: null };
  const set = (p: Partial<ExportOptions>) => setO({ ...opts, ...p });
  const run = async () => {
    setBusy(true);
    try {
      const { chapterIds, ...keep } = opts; void chapterIds;
      await db.projects.update(projectId, { exportOptions: keep, author: opts.author });
      const ok = await exportManuscript(projectId, fmt, opts);
      if (ok && fmt !== 'pdf') toast('Exported'); else if (fmt === 'pdf') toast(pdfHint());
      if (ok) onClose();
    } catch (e) { toast('Export failed: ' + (e as Error).message); }
    setBusy(false);
  };
  const sel = opts.chapterIds;
  return (
    <Modal title="Export manuscript" wide onClose={onClose}>
      <div className="export">
        <div className="export-formats">
          {FORMATS.map((f) => (
            <button key={f.id} className={'export-format' + (fmt === f.id ? ' on' : '')} onClick={() => setFmt(f.id)}>
              <f.icon size={20} /><strong>{f.label}</strong><span className="muted small">{f.ext}</span>
            </button>
          ))}
        </div>
        <div className="export-body">
          <div className="fgrid">
            {(fmt === 'docx' || fmt === 'pdf') && <>
              <label className="sfield"><span>Font</span><select className="input" value={opts.font} onChange={(e) => set({ font: e.target.value })}>{['Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Book Antiqua', 'Cambria', 'Courier New', 'Arial', 'Calibri'].map((f) => <option key={f}>{f}</option>)}</select></label>
              <label className="sfield"><span>Size (pt)</span><input className="input" type="number" min={8} max={20} value={opts.size} onChange={(e) => set({ size: +e.target.value || 12 })} /></label>
              <label className="sfield"><span>Line spacing</span><select className="input" value={opts.lineSpacing} onChange={(e) => set({ lineSpacing: +e.target.value })}><option value={1}>Single</option><option value={1.15}>1.15</option><option value={1.5}>1.5</option><option value={2}>Double</option></select></label>
            </>}
            <label className="sfield"><span>Chapter headings</span><select className="input" value={opts.chapterHeading} onChange={(e) => set({ chapterHeading: e.target.value as ExportOptions['chapterHeading'] })}>
              <option value="title">Chapter title</option><option value="number-title">Chapter 1: Title</option><option value="number">Chapter One</option><option value="none">No headings</option></select></label>
            <label className="sfield"><span>Scene separator</span><select className="input" value={opts.sceneSeparator} onChange={(e) => set({ sceneSeparator: e.target.value })}>{['* * *', '#', '~', '***', ''].map((x) => <option key={x} value={x}>{x || 'Blank line'}</option>)}</select></label>
            <label className="sfield"><span>Author name</span><input className="input" value={opts.author} onChange={(e) => set({ author: e.target.value })} placeholder="Shown on the title page" /></label>
          </div>
          <div className="row gap wrap">
            <label className="check"><input type="checkbox" checked={opts.titlePage} onChange={(e) => set({ titlePage: e.target.checked })} /> Title page</label>
            {(fmt === 'docx' || fmt === 'pdf') && <>
              <label className="check"><input type="checkbox" checked={opts.pageBreaks} onChange={(e) => set({ pageBreaks: e.target.checked })} /> New page for each chapter</label>
              <label className="check"><input type="checkbox" checked={opts.indentParagraphs} onChange={(e) => set({ indentParagraphs: e.target.checked })} /> Indent paragraphs (book style)</label>
            </>}
          </div>
          {(fmt === 'docx' || fmt === 'pdf') && <button className="btn ghost sm" onClick={() => set(MANUSCRIPT_PRESET)}>Use standard manuscript format (Times 12, double spaced)</button>}
          <div className="sfield">
            <div className="row"><span className="grow">Chapters</span>
              <button className="btn ghost sm" onClick={() => set({ chapterIds: null })}>All</button>
              <button className="btn ghost sm" onClick={() => set({ chapterIds: [] })}>None</button></div>
            <div className="export-chapters">
              {chapters.map((c) => (
                <label key={c.id} className="check small"><input type="checkbox" checked={!sel || sel.includes(c.id)}
                  onChange={(e) => { const cur = sel ?? chapters.map((x) => x.id); set({ chapterIds: e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id) }); }} /> {c.title}</label>
              ))}
            </div>
          </div>
          {fmt === 'pdf' && <p className="muted small">{pdfHint()}</p>}
          <div className="row end gap-s"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (sel !== null && !sel.length)} onClick={run}>{fmt === 'pdf' ? 'Open print dialog' : 'Export'}</button></div>
        </div>
      </div>
    </Modal>
  );
}
