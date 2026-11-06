import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Timer, Square } from 'lucide-react';
import { db } from '../db';
import { sprintWords, startSprint, stopSprint, useSprint } from '../stats';
import { toast } from './ui';
import { fmtNum } from '../util';

/** Writing sprint timer for the editor status bar */
export function SprintButton({ projectId }: { projectId: string }) {
  const sprint = useSprint();
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const words = useLiveQuery(async () => {
    if (!sprint) return 0;
    await db.activity.count(); // re-run whenever the activity log changes
    return sprintWords(sprint);
  }, [sprint]);
  useEffect(() => { if (!sprint) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [sprint]);
  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', c); return () => window.removeEventListener('mousedown', c);
  }, [open]);
  const finishing = useRef(false);
  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    const log = await stopSprint();
    finishing.current = false; if (log) { const m = Math.max(1, Math.round((log.end - log.start) / 60000)); toast(`Sprint done: ${fmtNum(log.words)} words in ${m} min (${Math.round(log.words / m)} wpm)`); }
  };

  if (sprint) {
    const elapsed = Date.now() - sprint.start;
    const remain = sprint.minutes ? sprint.minutes * 60000 - elapsed : elapsed;
    if (sprint.minutes && remain <= 0) { setTimeout(finish, 0); }
    const t = Math.max(0, Math.floor(Math.abs(remain) / 1000));
    const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
    const wpm = Math.round((words ?? 0) / Math.max(1, elapsed / 60000));
    return (
      <span className="sprint running">
        <Timer size={12} /> {mm}:{ss} · {fmtNum(words ?? 0)} words · {wpm} wpm
        <button className="icon-btn sm" title="Stop sprint" onClick={finish}><Square size={10} /></button>
      </span>
    );
  }
  return (
    <div className="sprint" ref={ref}>
      <button className="sprint-btn" onClick={() => setOpen(!open)} title="Writing sprint"><Timer size={12} /> Sprint</button>
      {open && (
        <div className="sprint-pop">
          <span className="muted small">Write without stopping for…</span>
          <div className="row gap-s wrap">{[10, 15, 25, 45, 60].map((m) => <button key={m} className="btn sm" onClick={() => { startSprint(projectId, m); setOpen(false); }}>{m} min</button>)}</div>
          <button className="btn ghost sm" onClick={() => { startSprint(projectId, 0); setOpen(false); }}>Open-ended (stopwatch)</button>
        </div>
      )}
    </div>
  );
}
