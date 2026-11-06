/*
 * PC app only: checks GitHub Releases for a newer Writell (shortly after start
 * and every few hours) and offers a one-click update. The download is checked
 * against the app's built-in public key, so only updates you signed install.
 */
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { isTauri } from '../platform';
import { flushAll } from '../saveRegistry';

type Upd = Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>>;

export function UpdateBanner() {
  const [upd, setUpd] = useState<NonNullable<Upd> | null>(null);
  const [phase, setPhase] = useState<'ready' | 'downloading' | 'installing' | 'error'>('ready');
  const [pct, setPct] = useState(0);
  const [later, setLater] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const look = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const u = await check();
        if (alive && u) { setUpd(u); setLater(false); }
      } catch { /* offline or no release yet: try again later */ }
    };
    const first = window.setTimeout(look, 4000);
    const every = window.setInterval(look, 6 * 3600_000);
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(every); };
  }, []);

  if (!upd || later) return null;
  const install = async () => {
    setPhase('downloading');
    try {
      await flushAll();
      let total = 0, got = 0;
      await upd.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress') { got += e.data.chunkLength; if (total) setPct(Math.min(100, Math.round((got / total) * 100))); }
        else if (e.event === 'Finished') setPhase('installing');
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch { setPhase('error'); }
  };
  return (
    <div className="update-bar" role="status">
      <Download size={15} />
      <span className="grow">
        {phase === 'ready' && <>Writell <strong>{upd.version}</strong> is available.</>}
        {phase === 'downloading' && <>Downloading Writell {upd.version}… {pct ? `${pct}%` : ''}</>}
        {phase === 'installing' && <>Installing… Writell will reopen in a moment.</>}
        {phase === 'error' && <>The update couldn't be installed. Check your internet connection and try again.</>}
      </span>
      {(phase === 'ready' || phase === 'error') && <button className="btn primary sm" onClick={install}>{phase === 'error' ? 'Try again' : 'Update now'}</button>}
      {phase === 'ready' && <button className="icon-btn sm" aria-label="Later" title="Later" onClick={() => setLater(true)}><X size={14} /></button>}
    </div>
  );
}
