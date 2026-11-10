/*
 * The little card that appears when you hover a character's name in your text.
 * Click it to open their profile.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { db } from '../db';
import { go } from '../nav';
import { lifespan } from '../charDates';
import { colorOf } from '../entities';
import { Avatar } from './story/common';

export interface CardAnchor { id: string; rect: DOMRect }

const STATUS_TONE: Record<string, string> = { Alive: 'var(--ok, #5fbf8f)', Dead: 'var(--danger)', Missing: '#e8925a', Unknown: 'var(--muted)' };

/** Text of the first filled field from a list, trimmed to a sentence or two */
function blurb(fields: Record<string, unknown>) {
  for (const k of ['summary', 'description', 'personality', 'appearance', 'backstory', 'notes']) {
    const v = String(fields[k] ?? '').trim();
    if (v) return v.length > 170 ? v.slice(0, 165).replace(/\s+\S*$/, '') + '…' : v;
  }
  return '';
}

export function CharacterHoverCard(props: { anchor: CardAnchor; projectId: string; onEnter: () => void; onLeave: () => void }) {
  return props.anchor.id.startsWith('term:') ? <TermCard {...props} /> : <CharCard {...props} />;
}

/** The card for a glossary word: what it means, and how else it's written */
function TermCard({ anchor, projectId, onEnter, onLeave }: { anchor: CardAnchor; projectId: string; onEnter: () => void; onLeave: () => void }) {
  const id = anchor.id.slice(5);
  const t = useLiveQuery(() => db.entities.get(id), [id]);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, r = anchor.rect;
    const below = r.bottom + h + 12 < innerHeight || r.top - h - 12 < 0;
    setPos({ left: Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)), top: below ? r.bottom + 8 : r.top - h - 8, below });
  }, [anchor, t]);
  if (!t) return null;
  const def = String(t.fields.definition ?? '').trim();
  const aka = String(t.fields.aliases ?? '').trim();
  return (
    <button ref={ref} className={'char-card term-card' + (pos?.below === false ? ' above' : '')} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseDown={(e) => e.preventDefault()}
      onClick={() => { onLeave(); go({ view: 'glossary', projectId, entityId: t.id }); }} aria-label={`Open ${t.name} in the glossary`}>
      <span className="char-card-body">
        <span className="char-card-name">{t.name}<ArrowUpRight size={13} className="char-card-go" /></span>
        {(t.fields.category || aka) ? <span className="char-card-meta">{t.fields.category ? <span>{String(t.fields.category)}</span> : null}{aka ? <span>also {aka}</span> : null}</span> : null}
        <span className="char-card-text">{def ? (def.length > 260 ? def.slice(0, 255).replace(/\s+\S*$/, '') + '…' : def) : <em className="muted">No meaning written yet.</em>}</span>
      </span>
    </button>
  );
}

function CharCard({ anchor, projectId, onEnter, onLeave }: { anchor: CardAnchor; projectId: string; onEnter: () => void; onLeave: () => void }) {
  const c = useLiveQuery(() => db.entities.get(anchor.id), [anchor.id]);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, r = anchor.rect;
    const below = r.bottom + h + 12 < innerHeight || r.top - h - 12 < 0;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    setPos({ left, top: below ? r.bottom + 8 : r.top - h - 8, below });
  }, [anchor, c]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onLeave(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onLeave]);
  if (!c) return null;
  const f = c.fields;
  const color = colorOf(c);
  const facts = [lifespan(c), f.age ? `Age ${f.age}` : '', f.occupation as string, f.gender as string].filter(Boolean) as string[];
  const text = blurb(f);
  return (
    <button ref={ref} className={'char-card' + (pos?.below === false ? ' above' : '')} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ...(color ? { ['--cc' as string]: color } : {}) }}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseDown={(e) => e.preventDefault()}
      onClick={() => { onLeave(); go({ view: 'characters', projectId, entityId: c.id }); }}
      aria-label={`Open ${c.name}'s profile`}>
      <Avatar name={c.name} image={f.image as string | undefined} size={56} color={color} />
      <span className="char-card-body">
        <span className="char-card-name">{c.name}<ArrowUpRight size={13} className="char-card-go" /></span>
        <span className="char-card-meta">
          {f.role ? <span>{String(f.role)}</span> : null}
          {f.status ? <span style={{ color: STATUS_TONE[String(f.status)] }}>{String(f.status)}</span> : null}
        </span>
        {facts.length > 0 && <span className="char-card-facts">{facts.join(' · ')}</span>}
        {text && <span className="char-card-text">{text}</span>}
      </span>
    </button>
  );
}

/**
 * Hover tracking for an element containing `.char-mention` spans.
 * Returns the current anchor plus enter/leave handlers for the card itself.
 */
export function useMentionHover(root: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [anchor, setAnchor] = useState<CardAnchor | null>(null);
  const hide = useRef<number | undefined>(undefined);
  const show = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = root.current; if (!el || !enabled) { setAnchor(null); return; }
    const over = (e: MouseEvent) => {
      const m = (e.target as HTMLElement).closest?.('.char-mention, .term-mention') as HTMLElement | null;
      if (!m || e.buttons) return;
      window.clearTimeout(hide.current); window.clearTimeout(show.current);
      const id = m.dataset.term ? 'term:' + m.dataset.term : m.dataset.char!;
      show.current = window.setTimeout(() => setAnchor({ id, rect: m.getBoundingClientRect() }), 280);
    };
    const out = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.char-mention, .term-mention')) return;
      window.clearTimeout(show.current);
      hide.current = window.setTimeout(() => setAnchor(null), 220);
    };
    const away = () => { window.clearTimeout(show.current); setAnchor(null); };
    el.addEventListener('mouseover', over); el.addEventListener('mouseout', out);
    el.addEventListener('keydown', away); window.addEventListener('scroll', away, true);
    return () => { el.removeEventListener('mouseover', over); el.removeEventListener('mouseout', out); el.removeEventListener('keydown', away); window.removeEventListener('scroll', away, true); window.clearTimeout(show.current); window.clearTimeout(hide.current); };
  }, [root, enabled]);
  return {
    anchor,
    enterCard: () => window.clearTimeout(hide.current),
    leaveCard: () => { window.clearTimeout(hide.current); hide.current = window.setTimeout(() => setAnchor(null), 160); },
    close: () => setAnchor(null),
  };
}
