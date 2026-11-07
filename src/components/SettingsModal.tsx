import { useEffect, useState } from 'react';
import { Palette, Type, Save, Info, Trash2, PanelLeft, Sparkles, ArrowUp, ArrowDown, Keyboard, FolderOpen, Cloud } from 'lucide-react';
import { AccountSettings } from './AccountSettings';
import { SHORTCUTS, combo, comboFromEvent } from '../shortcuts';
import { TEMPLATES } from '../templates';
import { defaultTools, orderedTools } from '../sidebarTools';
import { ALL_TOOLS, EDITOR_THEMES, FONTS, THEMES, resetSettings, setSettings, useSettings, type EditorTheme, type Theme } from '../settings';
import { setNav, useNav } from '../nav';
import { Modal, confirmDialog, promptDialog, toast } from './ui';
import { isTauri, requestPersistentStorage } from '../platform';
import { getBackupFolder, chooseBackupFolder } from '../backupService';

const TABS = [
  { id: 'account', label: 'Account & sync', icon: Cloud },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Type },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'backups', label: 'Saving & backups', icon: Save },
  { id: 'sidebar', label: 'Sidebar', icon: PanelLeft },
  { id: 'ai', label: 'AI tools (optional)', icon: Sparkles },
  { id: 'about', label: 'About & privacy', icon: Info },
];

const TOOL_LABEL: Record<string, string> = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', highlight: 'Highlight', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', bullet: 'Bulleted list', ordered: 'Numbered list', quote: 'Blockquote', link: 'Link', undo: 'Undo', redo: 'Redo' };

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="color-field"><input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} /><span>{label}</span></label>;
}
function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="slider-field"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <span className="muted small val">{fmt ? fmt(value) : value}</span>
    </label>
  );
}

export function SettingsModal() {
  const s = useSettings();
  const { settingsTab } = useNav();
  const tab = settingsTab;
  const allThemes = [...THEMES, ...s.customThemes];
  const allEd = [...EDITOR_THEMES, ...s.customEditorThemes];
  const setTheme = (p: Partial<Theme>) => setSettings({ theme: { ...s.theme, ...p, name: s.theme.name.endsWith('*') ? s.theme.name : s.theme.name + '*' } });
  const setEd = (p: Partial<EditorTheme>) => setSettings({ editorTheme: { ...s.editorTheme, bg: s.editorTheme.bg || s.theme.bg, text: s.editorTheme.text || s.theme.text, highlight: s.editorTheme.highlight || '#5a4a2a', ...p, name: s.editorTheme.name.endsWith('*') ? s.editorTheme.name : s.editorTheme.name + '*' } });

  return (
    <Modal title="Settings" wide onClose={() => setNav({ settingsOpen: false })}>
      <div className="settings">
        <nav className="settings-nav">
          {TABS.map((t) => <button key={t.id} className={'nav-item' + (tab === t.id ? ' active' : '')} onClick={() => setNav({ settingsTab: t.id })}><t.icon size={15} /> {t.label}</button>)}
        </nav>
        <div className="settings-body">
          {tab === 'appearance' && <>
            <h3>App theme</h3>
            <div className="theme-grid">
              {allThemes.map((t) => (
                <button key={t.name} className={'theme-chip' + (s.theme.name.replace('*', '') === t.name ? ' on' : '')} onClick={() => {
                  // keep the writing page readable when switching between light and dark
                  const ed = s.editorTheme;
                  const edDark = ed.bg ? parseInt(ed.bg.slice(1, 3), 16) < 128 : t.mode === 'dark';
                  const clash = !!ed.bg && edDark !== (t.mode === 'dark');
                  setSettings(clash ? { theme: t, editorTheme: EDITOR_THEMES[0] } : { theme: t });
                }} style={{ background: t.bg, color: t.text, borderColor: t.border }}>
                  <span className="dot" style={{ background: t.accent }} />{t.name}
                </button>
              ))}
            </div>
            <div className="color-row">
              <Color label="Accent" value={s.theme.accent} onChange={(v) => setTheme({ accent: v })} />
              <Color label="Background" value={s.theme.bg} onChange={(v) => setTheme({ bg: v })} />
              <Color label="Panels" value={s.theme.panel} onChange={(v) => setTheme({ panel: v })} />
              <Color label="Borders" value={s.theme.border} onChange={(v) => setTheme({ border: v })} />
              <Color label="Text" value={s.theme.text} onChange={(v) => setTheme({ text: v })} />
              <Color label="Muted text" value={s.theme.muted} onChange={(v) => setTheme({ muted: v })} />
            </div>
            <div className="row gap-s">
              <button className="btn sm" onClick={async () => { const n = await promptDialog('Save app theme as', s.theme.name.replace('*', '') + ' custom'); if (n) setSettings({ theme: { ...s.theme, name: n }, customThemes: [...s.customThemes.filter((x) => x.name !== n), { ...s.theme, name: n }] }); }}>Save as my theme</button>
              {s.customThemes.some((t) => t.name === s.theme.name) && <button className="btn ghost sm" onClick={() => setSettings({ customThemes: s.customThemes.filter((t) => t.name !== s.theme.name), theme: THEMES[0] })}><Trash2 size={13} /> Delete this theme</button>}
            </div>

            <h3>Writing area</h3>
            <p className="muted small">The page you write on can look different from the rest of the app.</p>
            <div className="theme-grid">
              {allEd.map((t) => (
                <button key={t.name} className={'theme-chip' + (s.editorTheme.name.replace('*', '') === t.name ? ' on' : '')} onClick={() => setSettings({ editorTheme: t })} style={{ background: t.bg || s.theme.bg, color: t.text || s.theme.text }}>{t.name}</button>
              ))}
            </div>
            <div className="color-row">
              <Color label="Page background" value={s.editorTheme.bg || s.theme.bg} onChange={(v) => setEd({ bg: v })} />
              <Color label="Text" value={s.editorTheme.text || s.theme.text} onChange={(v) => setEd({ text: v })} />
              <Color label="Highlight" value={s.editorTheme.highlight || '#5a4a2a'} onChange={(v) => setEd({ highlight: v })} />
            </div>
            <div className="row gap-s">
              <button className="btn sm" onClick={async () => { const n = await promptDialog('Save writing-area theme as', 'My page'); if (n) { const t = { ...s.editorTheme, name: n }; setSettings({ editorTheme: t, customEditorThemes: [...s.customEditorThemes.filter((x) => x.name !== n), t] }); } }}>Save as my page theme</button>
              {s.customEditorThemes.some((t) => t.name === s.editorTheme.name) && <button className="btn ghost sm" onClick={() => setSettings({ customEditorThemes: s.customEditorThemes.filter((t) => t.name !== s.editorTheme.name), editorTheme: EDITOR_THEMES[0] })}><Trash2 size={13} /> Delete</button>}
            </div>

            <h3>Layout</h3>
            <Slider label="Interface scale" value={s.uiScale} min={0.8} max={1.3} step={0.05} onChange={(v) => setSettings({ uiScale: v })} fmt={(v) => Math.round(v * 100) + '%'} />
            <Slider label="Sidebar width" value={s.sidebarWidth} min={200} max={480} step={10} onChange={(v) => setSettings({ sidebarWidth: v })} fmt={(v) => v + 'px'} />
            <label className="field"><span>Interface font</span>
              <select className="input" value={s.uiFont} onChange={(e) => setSettings({ uiFont: e.target.value })}>
                {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
          </>}

          {tab === 'editor' && <>
            <h3>Text</h3>
            <label className="field"><span>Writing font</span>
              <select className="input" value={s.editorFont} onChange={(e) => setSettings({ editorFont: e.target.value })}>
                {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
            <Slider label="Font size" value={s.editorFontSize} min={13} max={28} step={1} onChange={(v) => setSettings({ editorFontSize: v })} fmt={(v) => v + 'px'} />
            <Slider label="Line height" value={s.lineHeight} min={1.3} max={2.4} step={0.05} onChange={(v) => setSettings({ lineHeight: v })} fmt={(v) => v.toFixed(2)} />
            <Slider label="Paragraph spacing" value={s.paragraphSpacing} min={0} max={2} step={0.1} onChange={(v) => setSettings({ paragraphSpacing: v })} fmt={(v) => v.toFixed(1) + 'em'} />
            <h3>Writing width</h3>
            <div className="seg">
              {[['Narrow', 560], ['Medium', 720], ['Wide', 920], ['Full', 1600]].map(([l, w]) => <button key={l} className={s.editorWidth === w ? 'on' : ''} onClick={() => setSettings({ editorWidth: w as number })}>{l}</button>)}
            </div>
            <Slider label="Custom width" value={s.editorWidth} min={420} max={1600} step={10} onChange={(v) => setSettings({ editorWidth: v })} fmt={(v) => v + 'px'} />
            <Slider label="Side margins" value={s.editorMargin ?? 0} min={0} max={160} step={4} onChange={(v) => setSettings({ editorMargin: v })} fmt={(v) => v + 'px'} />
            <h3>When the app starts</h3>
            <label className="field"><span>Open the editor in</span>
              <select className="input" value={s.startMode} onChange={(e) => setSettings({ startMode: e.target.value as typeof s.startMode })}>
                <option value="writing">Writing mode</option><option value="editing">Editing mode (comments & revision tools)</option>
                <option value="focus">Focus mode (dim other paragraphs)</option><option value="typewriter">Typewriter mode</option>
              </select></label>
            <h3>Behaviour</h3>
            <label className="check"><input type="checkbox" checked={s.spellcheck} onChange={(e) => setSettings({ spellcheck: e.target.checked })} /> Spell checking (uses your system / browser dictionary)</label>
            <label className="check"><input type="checkbox" checked={s.charCards} onChange={(e) => setSettings({ charCards: e.target.checked })} /> Character cards: hover a character’s name in your text to see their picture and details</label>
            <label className="check"><input type="checkbox" checked={s.typewriter} onChange={(e) => setSettings({ typewriter: e.target.checked })} /> Typewriter mode — keep the current line centred</label>
            <label className="check"><input type="checkbox" checked={s.focusMode} onChange={(e) => setSettings({ focusMode: e.target.checked })} /> Focus mode — dim other paragraphs</label>
            <label className="check"><input type="checkbox" checked={s.showStatsBar} onChange={(e) => setSettings({ showStatsBar: e.target.checked })} /> Show word count bar</label>
            <label className="check"><input type="checkbox" checked={s.showStats} onChange={(e) => setSettings({ showStats: e.target.checked })} /> Statistics, goals and writing sprints</label>
            <h3>Toolbar buttons</h3>
            <div className="tool-grid">
              {ALL_TOOLS.map((t) => (
                <label key={t} className="check"><input type="checkbox" checked={s.toolbar.includes(t)} onChange={(e) => setSettings({ toolbar: e.target.checked ? ALL_TOOLS.filter((x) => x === t || s.toolbar.includes(x)) : s.toolbar.filter((x) => x !== t) })} /> {TOOL_LABEL[t]}</label>
              ))}
            </div>
          </>}

          {tab === 'keyboard' && <KeyboardSettings />}

          {tab === 'projects' && <>
            <h3>New projects</h3>
            <label className="field"><span>Start new projects from</span>
              <select className="input" value={s.defaultTemplate} onChange={(e) => setSettings({ defaultTemplate: e.target.value })}>{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <p className="muted small">You can still pick a different template each time. Export settings (font, spacing, headings) are remembered per project in the export window.</p>
          </>}

          {tab === 'backups' && <BackupSettings />}

          {tab === 'sidebar' && <>
            <h3>Project tools in the sidebar</h3>
            <p className="muted small">Choose which tools appear under a project, and in what order.</p>
            <div className="col gap-s">
              {orderedTools(s.sidebarTools).map((t, i, arr) => (
                <div key={t.id} className="row gap-s tool-row">
                  <label className="check grow"><input type="checkbox" checked={t.visible} onChange={(e) => setSettings({ sidebarTools: arr.map((x) => ({ id: x.id, visible: x.id === t.id ? e.target.checked : x.visible })) })} /> {t.label}</label>
                  <button className="icon-btn sm" disabled={i === 0} onClick={() => { const n = arr.map((x) => ({ id: x.id, visible: x.visible })); [n[i - 1], n[i]] = [n[i], n[i - 1]]; setSettings({ sidebarTools: n }); }}><ArrowUp size={13} /></button>
                  <button className="icon-btn sm" disabled={i === arr.length - 1} onClick={() => { const n = arr.map((x) => ({ id: x.id, visible: x.visible })); [n[i + 1], n[i]] = [n[i], n[i + 1]]; setSettings({ sidebarTools: n }); }}><ArrowDown size={13} /></button>
                </div>
              ))}
            </div>
            <button className="btn ghost sm" onClick={() => setSettings({ sidebarTools: defaultTools() })}>Reset order</button>
            <h3>Extras</h3>
            <label className="check"><input type="checkbox" checked={s.sbRecentScenes} onChange={(e) => setSettings({ sbRecentScenes: e.target.checked })} /> Show recently opened scenes</label>
            <label className="check"><input type="checkbox" checked={s.sbRecentChars} onChange={(e) => setSettings({ sbRecentChars: e.target.checked })} /> Show recently opened characters</label>
            <p className="muted small">Off by default to keep the sidebar simple. Favorites, pins and tabs are always there.</p>
          </>}

          {tab === 'ai' && <>
            <h3>Optional AI tools</h3>
            <p>Writell works fully without AI. If you turn this on, an <strong>AI assistant</strong> button appears in the editor with feedback, dialogue and consistency checks, plot-hole spotting, grammar suggestions, chapter summaries, prompts and brainstorming.</p>
            <p className="muted small">It uses your own Anthropic API key (from console.anthropic.com; usage is billed to you by Anthropic). Text is sent straight from this device to Anthropic only when you press an AI button, and AI never edits your text by itself. The key is stored on this device only.</p>
            <label className="check"><input type="checkbox" checked={s.aiEnabled} onChange={(e) => setSettings({ aiEnabled: e.target.checked })} /> Enable AI tools</label>
            {s.aiEnabled && <>
              <label className="field"><span>API key</span><input className="input" type="password" value={s.aiKey} placeholder="sk-ant-…" onChange={(e) => setSettings({ aiKey: e.target.value.trim() })} /></label>
              <label className="field"><span>Model</span><input className="input" value={s.aiModel} onChange={(e) => setSettings({ aiModel: e.target.value.trim() })} /></label>
            </>}
          </>}

          {tab === 'account' && <AccountSettings />}
          {tab === 'about' && <>
            <h3>Where your writing lives</h3>
            <p>Everything is stored <strong>only on this device</strong>, inside the app's private database{isTauri() ? ' (in your user profile folder)' : ' (this browser profile)'}. Nothing is uploaded anywhere — there is no account and no server in this version, so nobody else can see your work.</p>
            <p className="muted">Collaboration (Stage 4) will add an optional account. Only projects you choose to share will sync, and only to people you invite.</p>
            {!isTauri() && <p className="muted">On a school-managed Chromebook, the school's administrators may have access to the device's browser data. Clearing browser data for this site will also delete your projects — keep backup files.</p>}
            <h3>Reset</h3>
            <button className="btn ghost sm" onClick={async () => { if (await confirmDialog('Reset all appearance and editor settings?', 'Your projects are not affected.', { ok: 'Reset' })) { resetSettings(); toast('Settings reset'); } }}>Reset settings to defaults</button>
            <p className="muted small">Writell 0.14.0</p>
          </>}
        </div>
      </div>
    </Modal>
  );
}

function BackupSettings() {
  const s = useSettings();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [folder, setFolder] = useState<string | null>(getBackupFolder());
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1048576).toFixed(1)} MB used`)).catch(() => {});
  }, []);
  return <>
    <h3>Autosave</h3>
    <p className="muted small">Every change is saved automatically a moment after you stop typing, and again whenever you switch scenes, minimise or close the app.</p>
    <Slider label="Save delay" value={s.autosaveDelay} min={200} max={3000} step={100} onChange={(v) => setSettings({ autosaveDelay: v })} fmt={(v) => (v / 1000).toFixed(1) + 's'} />
    <h3>Automatic project backups</h3>
    <Slider label="Back up every" value={s.autoBackupMinutes} min={0} max={60} step={5} onChange={(v) => setSettings({ autoBackupMinutes: v })} fmt={(v) => (v ? v + ' min' : 'off')} />
    {isTauri() ? (
      <>
        <p className="muted small">Backups are kept inside the app <em>and</em>, if you choose a folder, also written there as .writell.json files (pick a OneDrive / Google Drive / Dropbox folder to get an off-computer copy).</p>
        <div className="row gap-s"><code className="grow ellipsis">{folder ?? 'No backup folder chosen'}</code><button className="btn sm" onClick={async () => setFolder(await chooseBackupFolder())}>Choose folder…</button></div>
      </>
    ) : (
      <p className="muted small">In the browser version, backups are kept inside the app. Use <strong>Full backup file</strong> on a project's overview page to save a copy to Google Drive or your Downloads folder.</p>
    )}
    <h3>Storage</h3>
    <p className="muted small">{usage} · {persisted ? 'Protected from automatic clean-up ✓' : 'Not yet protected from automatic browser clean-up'}</p>
    {!persisted && !isTauri() && <button className="btn sm" onClick={async () => { const ok = await requestPersistentStorage(); setPersisted(ok); toast(ok ? 'Storage is now protected' : 'The browser declined — installing the app usually allows it'); }}>Protect my data</button>}
  </>;
}

function KeyboardSettings() {
  const s = useSettings();
  const [rec, setRec] = useState<string | null>(null);
  useEffect(() => {
    if (!rec) return;
    const k = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRec(null); return; }
      const c = comboFromEvent(e); if (!c) return;
      setSettings({ shortcuts: { ...s.shortcuts, [rec]: c } }); setRec(null);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [rec, s.shortcuts]);
  const all = SHORTCUTS.map((x) => ({ ...x, cur: combo(x.id) }));
  const dupes = new Set(all.filter((a) => all.filter((b) => b.cur === a.cur).length > 1).map((a) => a.id));
  return <>
    <h3>Keyboard shortcuts</h3>
    <p className="muted small">Click a shortcut, then press the new key combination (Esc cancels). Bold, italic and other formatting keys are fixed.</p>
    <div className="kbd-list">
      {all.map((x) => (
        <div key={x.id} className="row gap-s kbd-row">
          <span className="grow">{x.label}</span>
          {dupes.has(x.id) && <span className="badge-warn">used twice</span>}
          <button className={'kbd-btn' + (rec === x.id ? ' rec' : '')} onClick={() => setRec(x.id)} aria-label={`Change shortcut for ${x.label}, currently ${x.cur}`}>{rec === x.id ? 'Press keys…' : x.cur}</button>
          {s.shortcuts[x.id] && <button className="icon-btn sm" title="Back to default" onClick={() => { const n = { ...s.shortcuts }; delete n[x.id]; setSettings({ shortcuts: n }); }}><ArrowUp size={12} style={{ transform: 'rotate(-90deg)' }} /></button>}
        </div>
      ))}
    </div>
    <button className="btn ghost sm" onClick={() => setSettings({ shortcuts: {} })}>Reset all shortcuts</button>
  </>;
}
