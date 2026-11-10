import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Flame, Target, Trophy, Timer } from 'lucide-react';
import { db } from '../db';
import { setSettings, useSettings } from '../settings';
import { MILESTONES, dailyTotals, dayKey, daysAgo, getSprintLog, startOfMonth, startOfWeek, streaks, sumRange } from '../stats';
import { STATUS_COLOR, STATUS_LABEL } from './ui';
import { fmtNum } from '../util';
import { go, getNav, setNav } from '../nav';

export function StatsView({ scope = '' }: { scope?: string }) {
  const s = useSettings();
  const projects = useLiveQuery(() => db.projects.filter((p) => !p.archived).toArray(), []);
  const days = useLiveQuery(() => dailyTotals(scope || undefined), [scope]);
  const content = useLiveQuery(async () => {
    const scenes = scope ? await db.scenes.where('projectId').equals(scope).toArray() : await db.scenes.toArray();
    const chapters = scope ? await db.chapters.where('projectId').equals(scope).toArray() : await db.chapters.toArray();
    return { words: scenes.reduce((a, x) => a + x.words, 0), chapters, scenes };
  }, [scope]);
  const [hover, setHover] = useState<string | null>(null);
  if (!projects || !days || !content) return null;
  const project = projects.find((p) => p.id === scope);
  const today = days.get(dayKey()) ?? 0;
  const week = sumRange(days, startOfWeek());
  const month = sumRange(days, startOfMonth());
  const st = streaks(days);
  const last30 = Array.from({ length: 30 }, (_, i) => { const d = daysAgo(29 - i); return { d, k: dayKey(d), w: days.get(dayKey(d)) ?? 0 }; });
  const avg = Math.round(last30.reduce((a, x) => a + x.w, 0) / 30);
  const maxBar = Math.max(s.dailyGoal, ...last30.map((x) => x.w), 1);
  const sprints = getSprintLog().filter((x) => !scope || x.projectId === scope).slice(-8).reverse();

  // heatmap: last 53 weeks, columns = weeks starting Monday
  const start = daysAgo(7 * 52 + ((new Date().getDay() + 6) % 7));
  const cells: { k: string; w: number; d: Date }[] = [];
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) cells.push({ k: dayKey(d), w: days.get(dayKey(d)) ?? 0, d: new Date(d) });
  const level = (w: number) => (w <= 0 ? 0 : w < s.dailyGoal * 0.25 ? 1 : w < s.dailyGoal * 0.6 ? 2 : w < s.dailyGoal ? 3 : 4);

  const goal = (label: string, val: number, target: number, key: 'dailyGoal' | 'weeklyGoal' | 'monthlyGoal') => (
    <div className="goal">
      <div className="row"><span className="grow">{label}</span><strong>{fmtNum(val)}</strong><span className="muted">&nbsp;/&nbsp;</span>
        <input className="goal-input" type="number" min={0} step={100} value={target} onChange={(e) => setSettings({ [key]: Math.max(0, +e.target.value || 0) })} aria-label={`${label} goal`} /></div>
      <div className="progress"><div style={{ width: `${target ? Math.min(100, (val / target) * 100) : 0}%`, background: target && val >= target ? '#5fbf8f' : undefined }} /></div>
    </div>
  );

  const statusCounts = (['idea', 'draft', 'revising', 'done'] as const).map((k) => ({ k, n: content.chapters.filter((c) => c.status === k).length }));
  const totalCh = content.chapters.length || 1;
  const reached = MILESTONES.filter((m) => content.words >= m);
  const next = MILESTONES.find((m) => content.words < m);

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Statistics</h1><p className="muted">Only you see these. Turn them off any time in Settings → Editor.</p></div>
        <select className="pill-select" value={scope} onChange={(e) => (getNav().panel?.view === 'statistics' ? setNav({ panel: { view: 'statistics', scope: e.target.value } }) : go({ view: 'statistics', scope: e.target.value }))}>
          <option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </header>

      <div className="stat-row">
        <div className="stat"><span className="muted small">Today</span><strong>{fmtNum(today)}</strong></div>
        <div className="stat"><span className="muted small">This week</span><strong>{fmtNum(week)}</strong></div>
        <div className="stat"><span className="muted small">This month</span><strong>{fmtNum(month)}</strong></div>
        <div className="stat"><span className="muted small">Total words {project ? 'in project' : 'written'}</span><strong>{fmtNum(content.words)}</strong></div>
        <div className="stat"><span className="muted small"><Flame size={12} /> Streak</span><strong>{st.current} day{st.current === 1 ? '' : 's'}</strong><span className="muted small">best {st.best}</span></div>
        <div className="stat"><span className="muted small">Average / day (30 d)</span><strong>{fmtNum(avg)}</strong></div>
      </div>

      <section className="two-col">
        <div className="card pad">
          <h3><Target size={15} /> Goals</h3>
          <div className="col gap">{goal('Today', today, s.dailyGoal, 'dailyGoal')}{goal('This week', week, s.weeklyGoal, 'weeklyGoal')}{goal('This month', month, s.monthlyGoal, 'monthlyGoal')}</div>
          {project && (
            <div className="goal" style={{ marginTop: 14 }}>
              <div className="row"><span className="grow">Project target</span><strong>{fmtNum(content.words)}</strong><span className="muted">&nbsp;/&nbsp;{project.goalWords ? fmtNum(project.goalWords) : 'not set'}</span></div>
              {project.goalWords > 0 && <div className="progress"><div style={{ width: `${Math.min(100, (content.words / project.goalWords) * 100)}%` }} /></div>}
              {project.deadline && project.goalWords > content.words && (() => {
                const left = Math.ceil((new Date(project.deadline + 'T23:59:59').getTime() - Date.now()) / 86400000);
                return <p className="muted small">{left > 0 ? `${fmtNum(Math.ceil((project.goalWords - content.words) / left))} words a day to finish by ${new Date(project.deadline).toLocaleDateString()}` : 'Deadline passed'}</p>;
              })()}
            </div>
          )}
        </div>
        <div className="card pad">
          <h3>Last 30 days</h3>
          <svg viewBox="0 0 600 170" className="bars" role="img" aria-label="Words per day, last 30 days">
            <line x1={0} x2={600} y1={150 - (s.dailyGoal / maxBar) * 130} y2={150 - (s.dailyGoal / maxBar) * 130} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} />
            <text x={596} y={146 - (s.dailyGoal / maxBar) * 130} fill="var(--muted)" fontSize={10} textAnchor="end">goal {fmtNum(s.dailyGoal)}</text>
            {last30.map((x, i) => (
              <g key={x.k} onMouseEnter={() => setHover(`${x.d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmtNum(x.w)} words`)} onMouseLeave={() => setHover(null)}>
                <rect x={i * 20 + 3} y={0} width={16} height={150} fill="transparent" />
                <rect x={i * 20 + 3} y={150 - (x.w / maxBar) * 130} width={14} height={Math.max(x.w ? 2 : 0, (x.w / maxBar) * 130)} rx={3} fill={x.w >= s.dailyGoal ? '#5fbf8f' : 'var(--accent)'} opacity={i === 29 ? 1 : 0.8} />
              </g>
            ))}
            <text x={3} y={166} fill="var(--muted)" fontSize={10}>{last30[0].d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>
            <text x={597} y={166} fill="var(--muted)" fontSize={10} textAnchor="end">today</text>
          </svg>
          <p className="muted small" style={{ minHeight: 18 }}>{hover ?? 'Hover a bar for details.'}</p>
        </div>
      </section>

      <section className="card pad" style={{ marginTop: 14 }}>
        <h3>Writing calendar</h3>
        <div className="heatmap-scroll">
          <div className="heatmap" style={{ gridTemplateColumns: `repeat(${Math.ceil(cells.length / 7)}, 12px)` }}>
            {cells.map((c) => <div key={c.k} className={'hm l' + level(c.w)} title={`${c.d.toLocaleDateString()}: ${fmtNum(c.w)} words`} />)}
          </div>
        </div>
        <div className="row gap-s small muted"><span>Less</span>{[0, 1, 2, 3, 4].map((l) => <div key={l} className={'hm l' + l} />)}<span>More (full square = daily goal)</span></div>
      </section>

      <section className="two-col">
        <div className="card pad">
          <h3>Chapter progress</h3>
          <div className="stack-bar">{statusCounts.map(({ k, n }) => n > 0 && <div key={k} style={{ width: `${(n / totalCh) * 100}%`, background: STATUS_COLOR[k] }} title={`${STATUS_LABEL[k]}: ${n}`} />)}</div>
          <div className="row gap wrap small">{statusCounts.map(({ k, n }) => <span key={k} className="row gap-s"><span className="status-dot" style={{ background: STATUS_COLOR[k] }} />{STATUS_LABEL[k]} {n}</span>)}</div>
          <p className="muted small">{content.chapters.length} chapters · {content.scenes.length} scenes · {content.scenes.filter((x) => x.status === 'done').length} scenes done</p>
        </div>
        <div className="card pad">
          <h3><Trophy size={15} /> Milestones</h3>
          <div className="milestones">{MILESTONES.map((m) => <span key={m} className={'milestone' + (reached.includes(m) ? ' on' : '')}>{m >= 1000 ? `${m / 1000}k` : m}</span>)}</div>
          {next && <p className="muted small">{fmtNum(next - content.words)} words to {fmtNum(next)}.</p>}
          <h3 style={{ marginTop: 16 }}><Timer size={15} /> Recent writing sprints</h3>
          {!sprints.length && <p className="muted small">Start a sprint from the timer in the editor's bottom bar.</p>}
          {sprints.map((x) => {
            const mins = Math.max(1, Math.round((x.end - x.start) / 60000));
            return <div key={x.start} className="row gap-s small"><span className="grow">{new Date(x.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span>{mins} min</span><strong>{fmtNum(x.words)} words</strong><span className="muted">{Math.round(x.words / mins)} wpm</span></div>;
          })}
        </div>
      </section>
    </div>
  );
}
