import { db, exportProject, importProject, uid, now, type ProjectExport } from './db';
import { jsonToMarkdown, jsonToText, markdownToJson } from './editor/extensions';
import { safeName, saveFile, saveBinary, pickFile } from './util';

async function ordered(projectId: string) {
  const chapters = await db.chapters.where('projectId').equals(projectId).sortBy('order');
  const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
  return chapters.map((c) => ({ chapter: c, scenes: scenes.filter((s) => s.chapterId === c.id).sort((a, b) => a.order - b.order) }));
}

const SCENE_BREAK_MD = '\n\n* * *\n\n';

export async function exportProjectMarkdown(projectId: string) {
  const p = await db.projects.get(projectId);
  if (!p) return;
  const parts = [`# ${p.title}\n`];
  for (const { chapter, scenes } of await ordered(projectId)) {
    parts.push(`\n## ${chapter.title}\n\n` + scenes.map((s) => jsonToMarkdown(s.content).trim()).filter(Boolean).join(SCENE_BREAK_MD));
  }
  return saveFile(`${safeName(p.title)}.md`, parts.join('\n') + '\n', 'text/markdown');
}

export async function exportProjectText(projectId: string) {
  const p = await db.projects.get(projectId);
  if (!p) return;
  const parts = [p.title.toUpperCase(), ''];
  for (const { chapter, scenes } of await ordered(projectId)) {
    parts.push('', chapter.title, '', scenes.map((s) => jsonToText(s.content).trim()).filter(Boolean).join('\n\n*\n\n'));
  }
  return saveFile(`${safeName(p.title)}.txt`, parts.join('\n') + '\n');
}

export async function exportChapterMarkdown(chapterId: string) {
  const c = await db.chapters.get(chapterId);
  if (!c) return;
  const scenes = await db.scenes.where('chapterId').equals(chapterId).sortBy('order');
  return saveFile(`${safeName(c.title)}.md`, `# ${c.title}\n\n` + scenes.map((s) => jsonToMarkdown(s.content).trim()).join(SCENE_BREAK_MD) + '\n', 'text/markdown');
}

export async function exportBackupFile(projectId: string) {
  const data = await exportProject(projectId);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return saveFile(`${safeName(data.project.title)} ${stamp}.writell.json`, JSON.stringify(data), 'application/json');
}

export async function importBackupFile(): Promise<string | null> {
  const f = await pickFile('.json,.writell.json,.inkwell.json,application/json');
  if (!f) return null;
  let data: ProjectExport;
  try { data = JSON.parse(f.text); } catch { throw new Error('That file is not valid JSON.'); }
  return importProject(data);
}

/**
 * Import a Markdown / text manuscript as a new project.
 * Top-level headings (# or ##, whichever comes first) become chapters;
 * "* * *", "***" or "---" lines become scene breaks.
 */
export async function importManuscript(): Promise<string | null> {
  const f = await pickFile('.md,.markdown,.txt,text/plain,text/markdown');
  if (!f) return null;
  const text = f.text.replace(/\r\n?/g, '\n');
  const title = f.name.replace(/\.(md|markdown|txt)$/i, '');
  const level = /^# /m.test(text) ? '# ' : /^## /m.test(text) ? '## ' : null;
  const chunks: { title: string; body: string }[] = [];
  if (level) {
    let cur: { title: string; body: string } | null = null;
    for (const line of text.split('\n')) {
      if (line.startsWith(level)) { if (cur) chunks.push(cur); cur = { title: line.slice(level.length).trim() || 'Untitled', body: '' }; }
      else if (cur) cur.body += line + '\n';
      else if (line.trim()) { cur = { title: 'Opening', body: line + '\n' }; }
    }
    if (cur) chunks.push(cur);
  } else chunks.push({ title: 'Chapter 1', body: text });

  const isTxt = /\.txt$/i.test(f.name);
  const pid = uid();
  const t = now();
  await db.transaction('rw', db.projects, db.chapters, db.scenes, async () => {
    await db.projects.add({ id: pid, title, description: `Imported from ${f.name}`, color: '#8b7cf6', favorite: false, archived: false, goalWords: 0, createdAt: t, updatedAt: t, openedAt: t });
    for (let i = 0; i < chunks.length; i++) {
      const chId = uid();
      await db.chapters.add({ id: chId, projectId: pid, title: chunks[i].title, summary: '', notes: '', order: i, status: 'draft', color: '', createdAt: t, updatedAt: t });
      const scenes = chunks[i].body.split(/\n[ \t]*(?:\* \* \*|\*\*\*|---|#)[ \t]*\n/);
      for (let j = 0; j < scenes.length; j++) {
        const body = scenes[j].trim();
        if (!body && scenes.length > 1) continue;
        const content = isTxt
          ? { type: 'doc', content: body.split(/\n\s*\n/).map((p) => ({ type: 'paragraph', content: p.trim() ? [{ type: 'text', text: p.replace(/\n/g, ' ') }] : undefined })) }
          : markdownToJson(body);
        const words = (jsonToText(content).match(/[\p{L}\p{N}’'-]+/gu) ?? []).length;
        await db.scenes.add({ id: uid(), projectId: pid, chapterId: chId, title: `Scene ${j + 1}`, summary: '', notes: '', order: j, status: 'draft', content, words, createdAt: t, updatedAt: t });
      }
    }
  });
  return pid;
}

/* ---------------- Characters / world / notes as Markdown ---------------- */

import { CHARACTER_SECTIONS, worldSections, sideLabel } from './entities';

export async function entityMarkdown(id: string): Promise<string> {
  const e = await db.entities.get(id);
  if (!e) return '';
  const lines: string[] = [`# ${e.name}`, ''];
  const meta: string[] = [];
  if (e.kind === 'character') { if (e.fields.role) meta.push(`Role: ${e.fields.role}`); if (e.fields.status) meta.push(`Status: ${e.fields.status}`); }
  if (e.kind === 'world' && e.fields.category) meta.push(`Category: ${e.fields.category}`);
  if (e.kind === 'world' && e.fields.parentId) { const parent = await db.entities.get(String(e.fields.parentId)); if (parent) meta.push(`Part of: ${parent.name}`); }
  if (e.kind === 'note' && e.fields.type) meta.push(`Type: ${e.fields.type}`);
  if (e.tags.length) meta.push('Tags: ' + e.tags.map((t) => '#' + t).join(' '));
  if (meta.length) lines.push(meta.join(' · '), '');
  const sections = e.kind === 'character' ? CHARACTER_SECTIONS : e.kind === 'world' ? worldSections(String(e.fields.category ?? '')) : [{ title: '', fields: [{ key: 'body', label: '' }] }];
  for (const sec of sections) {
    const filled = sec.fields.filter((f) => String(e.fields[f.key] ?? '').trim());
    if (!filled.length) continue;
    if (sec.title) lines.push(`## ${sec.title}`, '');
    for (const f of filled) {
      if (f.label && sec.fields.length > 1) lines.push(`**${f.label}:** ${String(e.fields[f.key]).trim()}`, '');
      else lines.push(String(e.fields[f.key]).trim(), '');
    }
  }
  const custom = (e.fields.custom as { label: string; value: string }[] | undefined)?.filter((c) => c.value.trim()) ?? [];
  if (custom.length) { lines.push('## Other', ''); custom.forEach((c) => lines.push(`**${c.label}:** ${c.value.trim()}`, '')); }
  // relationships
  const ls = [...await db.links.where('[fromType+fromId]').equals(['entity', id]).toArray(), ...await db.links.where('[toType+toId]').equals(['entity', id]).toArray()].filter((l) => l.relation === 'related');
  if (ls.length) {
    const others = await db.entities.bulkGet(ls.map((l) => (l.fromId === id ? l.toId : l.fromId)));
    lines.push('## Connections', '');
    ls.forEach((l, i) => { const lab = sideLabel(l, id); if (others[i]) lines.push(`- ${others[i]!.name}${lab ? ` — ${lab}` : ''}`); });
    lines.push('');
  }
  return lines.join('\n');
}

export async function exportEntityMarkdown(id: string) {
  const e = await db.entities.get(id);
  if (!e) return;
  return saveFile(`${safeName(e.name || 'note')}.md`, await entityMarkdown(id), 'text/markdown');
}

export async function exportAllEntitiesMarkdown(projectId: string, kind: 'character' | 'world' | 'note') {
  const p = await db.projects.get(projectId);
  const items = (await db.entities.where('[projectId+kind]').equals([projectId, kind]).toArray()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const label = { character: 'Characters', world: 'Worldbuilding', note: 'Notes' }[kind];
  const parts = [`# ${p?.title ?? ''} — ${label}`, ''];
  for (const e of items) parts.push((await entityMarkdown(e.id)).replace(/^(#+) /gm, '#$1 '), '\n---\n');
  return saveFile(`${safeName(p?.title ?? 'project')} - ${label}.md`, parts.join('\n'), 'text/markdown');
}

/* ---------------- Word (.docx) ---------------- */

type PMNode = { type: string; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: PMNode[]; attrs?: Record<string, unknown> };

export async function exportProjectDocx(projectId: string) {
  const p = await db.projects.get(projectId);
  if (!p) return;
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, ExternalHyperlink } = d;

  const runs = (nodes: PMNode[] | undefined, extra: { italics?: boolean } = {}): (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] =>
    (nodes ?? []).flatMap((n): (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] => {
      if (n.type === 'hardBreak') return [new TextRun({ text: '', break: 1 })];
      if (n.type !== 'text') return [];
      const has = (t: string) => n.marks?.some((m) => m.type === t);
      const run = new TextRun({
        text: n.text ?? '', bold: has('bold'), italics: has('italic') || extra.italics, strike: has('strike'),
        underline: has('underline') ? {} : undefined, highlight: has('highlight') ? 'yellow' : undefined,
      });
      const link = n.marks?.find((m) => m.type === 'link');
      return link ? [new ExternalHyperlink({ link: String(link.attrs?.href ?? ''), children: [run] })] as (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] : [run];
    });

  const blocks = (nodes: PMNode[] | undefined, ctx: { quote?: boolean; list?: 'bullet' | 'number'; level?: number } = {}): InstanceType<typeof Paragraph>[] =>
    (nodes ?? []).flatMap((n): InstanceType<typeof Paragraph>[] => {
      switch (n.type) {
        case 'paragraph':
          return [new Paragraph({ children: runs(n.content, { italics: ctx.quote }), indent: ctx.quote ? { left: 720 } : undefined,
            ...(ctx.list === 'bullet' ? { bullet: { level: ctx.level ?? 0 } } : ctx.list === 'number' ? { numbering: { reference: 'num', level: ctx.level ?? 0 } } : {}),
            spacing: { after: 160, line: 360 } })];
        case 'heading': {
          const lvl = Number(n.attrs?.level ?? 1);
          return [new Paragraph({ children: runs(n.content), heading: lvl === 1 ? HeadingLevel.HEADING_2 : lvl === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4 })];
        }
        case 'blockquote': return blocks(n.content, { ...ctx, quote: true });
        case 'bulletList': return (n.content ?? []).flatMap((li) => blocks(li.content, { ...ctx, list: 'bullet', level: ctx.list ? (ctx.level ?? 0) + 1 : 0 }));
        case 'orderedList': return (n.content ?? []).flatMap((li) => blocks(li.content, { ...ctx, list: 'number', level: ctx.list ? (ctx.level ?? 0) + 1 : 0 }));
        case 'horizontalRule': return [new Paragraph({ children: [new TextRun('* * *')], alignment: AlignmentType.CENTER })];
        default: return blocks(n.content, ctx);
      }
    });

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ children: [new TextRun({ text: p.title, size: 56, bold: true })], alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 400 } }),
  ];
  for (const { chapter, scenes } of await ordered(projectId)) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_1, spacing: { after: 360 } }));
    scenes.forEach((s, i) => {
      if (i > 0) children.push(new Paragraph({ children: [new TextRun('* * *')], alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 } }));
      children.push(...blocks((s.content as PMNode).content));
    });
  }
  const doc = new Document({
    creator: 'Writell', title: p.title,
    styles: { default: { document: { run: { font: 'Georgia', size: 24 } } } },
    numbering: { config: [{ reference: 'num', levels: [0, 1, 2].map((level) => ({ level, format: 'decimal' as const, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) }] },
    sections: [{ children }],
  });
  const buf = await Packer.toArrayBuffer(doc);
  return saveBinary(`${safeName(p.title)}.docx`, new Uint8Array(buf), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
