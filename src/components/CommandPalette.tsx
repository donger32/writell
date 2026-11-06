import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, FileText, Plus, Settings, Home, Crosshair, AlignVerticalJustifyCenter, Maximize2, Download, Search, Users, Globe, StickyNote } from 'lucide-react';
import { createEntity } from '../entities';
import { promptDialog } from './ui';
import { openEntity } from './story/links';
import { db, createChapter } from '../db';
import { go, openProject, setNav, useNav } from '../nav';
import { setSettings, getSettings } from '../settings';
import { newProjectFlow } from './Home';
import { toggleFullscreen } from './EditorPane';
import { exportBackupFile } from '../exporting';
import { sceneText } from '../editor/extensions';

interface Cmd { id: string; label: string; hint?: string; also?: string; icon: React.ReactNode; run: () => void; group: string }

export function CommandPalette() {
  const { route } = useNav();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectId = 'projectId' in route ? route.projectId : null;
  useEffect(() => inputRef.current?.focus(), []);

  const data = useLiveQuery(async () => {
    const [projects, chapters, scenes, entities] = await Promise.all([db.projects.toArray(), db.chapters.toArray(), db.scenes.toArray(), db.entities.toArray()]);
    return { projects, chapters, scenes, entities };
  }, []);

  // full-text search inside scene content (only when query is 3+ chars)
  const textHits = useMemo(() => {
    if (!data || q.trim().length < 3) return [];
    const needle = q.trim().toLowerCase();
    const hits: { sceneId: string; projectId: string; snippet: string }[] = [];
    const pool = projectId ? data.scenes.filter((s) => s.projectId === projectId) : data.scenes;
    for (const s of pool) {
      if (!s.words) continue;
      const t = sceneText(s);
      const i = t.toLowerCase().indexOf(needle);
      if (i >= 0) hits.push({ sceneId: s.id, projectId: s.projectId, snippet: (i > 30 ? '…' : '') + t.slice(Math.max(0, i - 30), i + needle.length + 40).replace(/\s+/g, ' ') + '…' });
      if (hits.length >= 8) break;
    }
    return hits;
  }, [data, q, projectId]);

  const cmds = useMemo<Cmd[]>(() => {
    const close = () => setNav({ paletteOpen: false });
    const list: Cmd[] = [
      { id: 'home', group: 'Go to', label: 'Home', icon: <Home size={14} />, run: () => go({ view: 'home' }) },
      { id: 'new-project', group: 'Actions', label: 'New project', icon: <Plus size={14} />, run: () => { close(); newProjectFlow(); } },
      { id: 'friends', group: 'Go to', label: 'Friends', also: 'people profile username', icon: <Users size={14} />, run: () => go({ view: 'friends' }) },
      { id: 'settings', group: 'Go to', label: 'Settings', icon: <Settings size={14} />, run: () => setNav({ settingsOpen: true }) },
      { id: 'focus', group: 'Actions', label: 'Toggle focus mode', icon: <Crosshair size={14} />, run: () => setSettings({ focusMode: !getSettings().focusMode }) },
      { id: 'typewriter', group: 'Actions', label: 'Toggle typewriter mode', icon: <AlignVerticalJustifyCenter size={14} />, run: () => setSettings({ typewriter: !getSettings().typewriter }) },
      { id: 'full', group: 'Actions', label: 'Toggle full screen', hint: 'F11', icon: <Maximize2 size={14} />, run: toggleFullscreen },
    ];
    if (projectId) {
      list.push(
        { id: 'new-chapter', group: 'Actions', label: 'New chapter', icon: <Plus size={14} />, run: async () => { const r = await createChapter(projectId); go({ view: 'write', projectId, sceneId: r.sceneId }); } },
        { id: 'overview', group: 'Go to', label: 'Project overview', icon: <BookOpen size={14} />, run: () => go({ view: 'project', projectId }) },
        { id: 'new-character', group: 'Actions', label: 'New character', icon: <Plus size={14} />, run: async () => { const name = await promptDialog('New character', '', 'Create'); if (name) { const id = await createEntity(projectId, 'character', name, { status: 'Alive', role: 'Supporting' }); go({ view: 'characters', projectId, entityId: id }); } } },
        { id: 'new-world', group: 'Actions', label: 'New worldbuilding entry', icon: <Plus size={14} />, run: () => go({ view: 'world', projectId }) },
        { id: 'quick-note', group: 'Actions', label: 'Quick idea to inbox', hint: 'Ctrl+Shift+N', icon: <StickyNote size={14} />, run: () => setNav({ quickNote: true }) },
        { id: 'characters', group: 'Go to', label: 'Character', also: 'Characters', icon: <Users size={14} />, run: () => go({ view: 'characters', projectId }) },
        { id: 'maps', group: 'Go to', label: 'Map', also: 'Maps', icon: <Globe size={14} />, run: () => go({ view: 'maps', projectId }) },
        { id: 'family', group: 'Go to', label: 'Tree', also: 'Family trees', icon: <Users size={14} />, run: () => go({ view: 'family', projectId }) },
        { id: 'relationships', group: 'Go to', label: 'Relation', also: 'Relationships', icon: <Users size={14} />, run: () => go({ view: 'relationships', projectId }) },
        { id: 'timelines', group: 'Go to', label: 'Timeline', also: 'Timelines', icon: <StickyNote size={14} />, run: () => go({ view: 'timelines', projectId }) },
        { id: 'world', group: 'Go to', label: 'Worldbuilding', icon: <Globe size={14} />, run: () => go({ view: 'world', projectId }) },
        { id: 'notes', group: 'Go to', label: 'Notes', icon: <StickyNote size={14} />, run: () => go({ view: 'notes', projectId }) },
        { id: 'tasks', group: 'Go to', label: 'Tasks', icon: <StickyNote size={14} />, run: () => go({ view: 'tasks', projectId }) },
        { id: 'trash', group: 'Go to', label: 'Trash', icon: <StickyNote size={14} />, run: () => go({ view: 'trash' }) },
        { id: 'search', group: 'Go to', label: 'Search this project', hint: 'Ctrl+Shift+F', icon: <Search size={14} />, run: () => go({ view: 'search', projectId }) },
        { id: 'backup', group: 'Actions', label: 'Export full backup of this project', icon: <Download size={14} />, run: () => exportBackupFile(projectId) },
      );
    }
    if (data) {
      for (const p of data.projects.filter((p) => !p.archived)) list.push({ id: 'p' + p.id, group: 'Projects', label: p.title, icon: <BookOpen size={14} />, run: () => openProject(p.id) });
      for (const e of data.entities.filter((e) => e.projectId === projectId || !projectId)) {
        const icon = e.kind === 'character' ? <Users size={14} /> : e.kind === 'world' ? <Globe size={14} /> : <StickyNote size={14} />;
        const group = e.kind === 'character' ? 'Characters' : e.kind === 'world' ? 'World' : 'Notes';
        list.push({ id: 'e' + e.id, group, label: e.name || 'Untitled note', hint: String(e.fields.category ?? e.fields.role ?? ''), icon, run: () => openEntity(e) });
      }
      const chMap = new Map(data.chapters.map((c) => [c.id, c]));
      const pMap = new Map(data.projects.map((p) => [p.id, p]));
      const scenes = [...data.scenes].sort((a, b) => (a.projectId === projectId ? -1 : 0) - (b.projectId === projectId ? -1 : 0));
      for (const s of scenes) {
        const ch = chMap.get(s.chapterId);
        list.push({ id: 's' + s.id, group: 'Chapters & scenes', label: `${ch?.title ?? ''} · ${s.title}`, hint: s.projectId !== projectId ? pMap.get(s.projectId)?.title : undefined, icon: <FileText size={14} />, run: () => go({ view: 'write', projectId: s.projectId, sceneId: s.id }) });
      }
    }
    return list;
  }, [data, projectId]);

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const base = terms.length ? cmds.filter((c) => terms.every((t) => (c.label + ' ' + (c.hint ?? '') + ' ' + (c.also ?? '')).toLowerCase().includes(t))) : cmds.filter((c) => (c.group !== 'Chapters & scenes' || c.hint === undefined) && !['Characters', 'World', 'Notes'].includes(c.group)).slice(0, 30);
    const text: Cmd[] = textHits.map((h) => ({ id: 't' + h.sceneId, group: 'Found in text', label: h.snippet, icon: <Search size={14} />, run: () => go({ view: 'write', projectId: h.projectId, sceneId: h.sceneId }) }));
    return [...base.slice(0, 40), ...text];
  }, [cmds, q, textHits]);

  useEffect(() => setSel(0), [q]);
  const run = (c: Cmd) => { setNav({ paletteOpen: false }); c.run(); };

  let lastGroup = '';
  return (
    <div className="overlay top" onMouseDown={(e) => e.target === e.currentTarget && setNav({ paletteOpen: false })}>
      <div className="palette" onKeyDown={(e) => {
        if (e.key === 'Escape') setNav({ paletteOpen: false });
        if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
        if (e.key === 'Enter' && filtered[sel]) run(filtered[sel]);
      }}>
        <input ref={inputRef} className="palette-input" placeholder="Search projects, chapters, scenes, text… or type a command" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="palette-list">
          {filtered.length === 0 && <div className="muted pad">Nothing found.</div>}
          {filtered.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="palette-group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head}
                <button className={'palette-item' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => run(c)} ref={(el) => { if (i === sel) el?.scrollIntoView({ block: 'nearest' }); }}>
                  {c.icon}<span className="grow ellipsis">{c.label}</span>{c.hint && <span className="muted small">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
