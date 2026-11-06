import { useState } from 'react';
import { Modal } from './ui';
import { TEMPLATES, createFromTemplate } from '../templates';
import { openProject, setNav } from '../nav';
import { fmtNum } from '../util';
import { getSettings } from '../settings';

export function NewProjectDialog() {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [tpl, setTpl] = useState(() => getSettings().defaultTemplate || 'blank');
  const close = () => setNav({ newProject: false });
  const create = async () => {
    const id = await createFromTemplate(title.trim() || 'Untitled novel', desc.trim(), tpl);
    close();
    openProject(id);
  };
  return (
    <Modal title="New project" onClose={close}>
      <div className="pad col gap" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') create(); }}>
        <label className="sfield"><span>Title</span><input className="input" autoFocus value={title} placeholder="Untitled novel" onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="sfield"><span>Description (optional)</span><input className="input" value={desc} placeholder="One line about the book" onChange={(e) => setDesc(e.target.value)} /></label>
        <div className="sfield"><span>Start from</span>
          <div className="tpl-grid">
            {TEMPLATES.map((t) => (
              <button key={t.id} className={'tpl' + (tpl === t.id ? ' on' : '')} onClick={() => setTpl(t.id)}>
                <strong>{t.name}</strong><span className="muted small">{t.description}</span>
                <span className="muted small">{t.chapters.length} chapter{t.chapters.length === 1 ? '' : 's'}{t.words ? ` · target ${fmtNum(t.words)} words` : ''}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="row end gap-s"><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={create}>Create project</button></div>
      </div>
    </Modal>
  );
}
