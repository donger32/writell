import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/400-italic.css';
import '@fontsource/literata/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/700.css';
import './styles.css';
import App from './App';
import { applySettingsToDOM, getSettings, setSettings } from './settings';
import { requestPersistentStorage, isTauri } from './platform';
import { startBackupLoop, runBackups } from './backupService';
import { flushAll } from './saveRegistry';
import { cleanupOrphans } from './db';
import { startSync } from './sync/engine';
import { startSocial } from './social/api';

applySettingsToDOM(getSettings());
{ const m = getSettings().startMode; if (m === 'focus' || m === 'typewriter') setSettings({ focusMode: m === 'focus', typewriter: m === 'typewriter' }); else setSettings({ focusMode: false, typewriter: false }); }
requestPersistentStorage();
startBackupLoop();
cleanupOrphans();
// account sync (does nothing until you sign in)
setTimeout(() => { void startSync().then(startSocial); }, 800);
window.addEventListener('beforeunload', () => { flushAll(); });

// Desktop app: behave like an app, not a web page
if (isTauri()) {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    // no accidental page reloads, browser print or browser find
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (k === 'r' || k === 'p')) || ((e.ctrlKey || e.metaKey) && k === 'f' && !e.defaultPrevented)) e.preventDefault();
  });
  // keep the native menu (with spelling suggestions) only where you can type
  window.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
  });
}

// Desktop app: when the window is closed, finish saving everything first
if (isTauri()) {
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    let closing = false;
    win.onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;
      try {
        await flushAll();
        await Promise.race([runBackups(), new Promise((r) => setTimeout(r, 4000))]);
      } finally {
        await win.destroy();
      }
    });
  });
}

// Offline support for the browser / Chromebook version
if (!isTauri() && 'serviceWorker' in navigator && import.meta.env.PROD && location.protocol.startsWith('http')) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}

// icon-only buttons: use their tooltip as the accessible name
new MutationObserver(() => {
  document.querySelectorAll<HTMLElement>('button[title]:not([aria-label])').forEach((b) => { if (!b.textContent?.trim()) b.setAttribute('aria-label', b.title); });
}).observe(document.body, { childList: true, subtree: true });

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
