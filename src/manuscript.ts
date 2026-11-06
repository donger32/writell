import { generateHTML, type JSONContent } from '@tiptap/core';
import { db, uid, now, type Project } from './db';
import { baseExtensions, jsonToMarkdown, jsonToText, htmlToJson, withoutDeletions } from './editor/extensions';
import { safeName, saveFile, saveBinary } from './util';
import { isTauri } from './platform';

/* =====================================================================
 * Manuscript export with formatting options (Markdown, TXT, Word, PDF)
 * ===================================================================== */

export interface ExportOptions {
  font: string;
  size: number;            // pt
  lineSpacing: number;     // 1, 1.5, 2
  titlePage: boolean;
  author: string;
  chapterHeading: 'title' | 'number-title' | 'number' | 'none';
  pageBreaks: boolean;
  sceneSeparator: string;  // '* * *', '#', '~', '' (blank line)
  indentParagraphs: boolean;
  chapterIds: string[] | null; // null = all
}

export const DEFAULT_EXPORT: ExportOptions = {
  font: 'Georgia', size: 12, lineSpacing: 1.5, titlePage: true, author: '', chapterHeading: 'title',
  pageBreaks: true, sceneSeparator: '* * *', indentParagraphs: true, chapterIds: null,
};

export const MANUSCRIPT_PRESET: Partial<ExportOptions> = { font: 'Times New Roman', size: 12, lineSpacing: 2, indentParagraphs: true, sceneSeparator: '#', titlePage: true, pageBreaks: true };

const NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const spell = (n: number) => NUM[n] ?? String(n);

function heading(title: string, i: number, o: ExportOptions) {
  switch (o.chapterHeading) {
    case 'number-title': return `Chapter ${i + 1}: ${title}`;
    case 'number': return `Chapter ${spell(i + 1)}`;
    case 'none': return '';
    default: return title;
  }
}

async function gather(projectId: string, o: ExportOptions) {
  const p = (await db.projects.get(projectId))!;
  const chapters = (await db.chapters.where('projectId').equals(projectId).sortBy('order')).filter((c) => !o.chapterIds || o.chapterIds.includes(c.id));
  const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
  return { p, parts: chapters.map((c, i) => ({ title: heading(c.title, i, o), scenes: scenes.filter((s) => s.chapterId === c.id).sort((a, b) => a.order - b.order) })) };
}

export async function exportManuscript(projectId: string, format: 'md' | 'txt' | 'docx' | 'pdf', o: ExportOptions) {
  const { p, parts } = await gather(projectId, o);
  const name = safeName(p.title);
  if (format === 'md') {
    const out = [o.titlePage ? `# ${p.title}\n${o.author ? `\n*by ${o.author}*\n` : ''}` : ''];
    for (const ch of parts) out.push(`${ch.title ? `\n## ${ch.title}\n\n` : '\n'}${ch.scenes.map((s) => jsonToMarkdown(s.content).trim()).filter(Boolean).join(`\n\n${o.sceneSeparator || '&nbsp;'}\n\n`)}`);
    return saveFile(`${name}.md`, out.join('\n') + '\n', 'text/markdown');
  }
  if (format === 'txt') {
    const out = [o.titlePage ? `${p.title.toUpperCase()}${o.author ? `\nby ${o.author}` : ''}\n\n` : ''];
    for (const ch of parts) out.push(`${ch.title ? `\n${ch.title}\n\n` : '\n'}${ch.scenes.map((s) => jsonToText(s.content).trim()).filter(Boolean).join(`\n\n${o.sceneSeparator}\n\n`)}`);
    return saveFile(`${name}.txt`, out.join('\n') + '\n');
  }
  if (format === 'pdf') return printPdf(p, parts, o);
  return exportDocx(p, parts, o);
}

/* ---------- PDF (via the system print dialog → "Save as PDF") ---------- */

function printPdf(p: Project, parts: { title: string; scenes: { content: unknown }[] }[], o: ExportOptions) {
  const ext = baseExtensions();
  const body = parts.map((ch) => `<section class="chapter">${ch.title ? `<h1>${esc(ch.title)}</h1>` : ''}${ch.scenes.map((s) => generateHTML(withoutDeletions(s.content) as JSONContent, ext)).join(`<p class="sep">${esc(o.sceneSeparator) || '&nbsp;'}</p>`)}</section>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>
    @page { size: A4; margin: 2.5cm 2.2cm; }
    body { font-family: '${o.font}', Georgia, serif; font-size: ${o.size}pt; line-height: ${o.lineSpacing * 1.15}; color: #000; }
    .title { height: 80vh; display: flex; flex-direction: column; justify-content: center; text-align: center; page-break-after: always; }
    .title h1 { font-size: 26pt; margin: 0 0 12pt; } .title p { font-size: 13pt; }
    h1 { font-size: 18pt; text-align: center; margin: 2em 0 1.5em; font-weight: normal; }
    ${o.pageBreaks ? '.chapter { page-break-before: always; } .chapter:first-of-type { page-break-before: auto; }' : '.chapter { margin-top: 3em; }'}
    p { margin: 0 0 ${o.indentParagraphs ? '0' : '0.8em'}; ${o.indentParagraphs ? 'text-indent: 1.5em;' : ''} orphans: 2; widows: 2; }
    h1 + p, .sep + p, h2 + p, h3 + p { text-indent: 0; }
    .sep { text-align: center; text-indent: 0; margin: 1em 0; }
    blockquote { margin: 0 2em; font-style: italic; } mark { background: #fff3a0; }
    span[data-comment], span[data-flag] { background: none; text-decoration: none; }
  </style></head><body>${o.titlePage ? `<div class="title"><h1>${esc(p.title)}</h1>${o.author ? `<p>by ${esc(o.author)}</p>` : ''}</div>` : ''}${body}</body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  return new Promise<boolean>((resolve) => {
    setTimeout(() => {
      try { frame.contentWindow!.focus(); frame.contentWindow!.print(); resolve(true); } catch { resolve(false); }
      setTimeout(() => frame.remove(), 60_000);
    }, 400);
  });
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/* ---------- Word ---------- */

type PMNode = { type: string; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: PMNode[]; attrs?: Record<string, unknown> };

async function exportDocx(p: Project, parts: { title: string; scenes: { content: unknown }[] }[], o: ExportOptions) {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, ExternalHyperlink } = d;
  type Run = InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>;
  const line = Math.round(240 * o.lineSpacing);
  const runs = (nodes: PMNode[] | undefined, italics = false): Run[] => (nodes ?? []).flatMap((n): Run[] => {
    if (n.type === 'hardBreak') return [new TextRun({ text: '', break: 1 })];
    if (n.type !== 'text') return [];
    const has = (t: string) => n.marks?.some((m) => m.type === t);
    const run = new TextRun({ text: n.text ?? '', bold: has('bold'), italics: has('italic') || italics, strike: has('strike'), underline: has('underline') ? {} : undefined, highlight: has('highlight') ? 'yellow' : undefined });
    const link = n.marks?.find((m) => m.type === 'link');
    return link ? [new ExternalHyperlink({ link: String(link.attrs?.href ?? ''), children: [run] })] : [run];
  });
  let firstPara = true;
  const para = (children: Run[], extra: Record<string, unknown> = {}) => {
    const p = new Paragraph({ children, spacing: { after: o.indentParagraphs ? 0 : 160, line }, indent: o.indentParagraphs && !firstPara ? { firstLine: 425 } : undefined, ...extra });
    firstPara = false;
    return p;
  };
  const blocks = (nodes: PMNode[] | undefined, ctx: { quote?: boolean; list?: 'bullet' | 'number'; level?: number } = {}): InstanceType<typeof Paragraph>[] =>
    (nodes ?? []).flatMap((n): InstanceType<typeof Paragraph>[] => {
      switch (n.type) {
        case 'paragraph':
          return [para(runs(n.content, ctx.quote), { ...(ctx.quote ? { indent: { left: 720 } } : {}), ...(ctx.list === 'bullet' ? { bullet: { level: ctx.level ?? 0 } } : ctx.list === 'number' ? { numbering: { reference: 'num', level: ctx.level ?? 0 } } : {}) })];
        case 'heading': { firstPara = true; const l = Number(n.attrs?.level ?? 1); return [new Paragraph({ children: runs(n.content), heading: l === 1 ? HeadingLevel.HEADING_2 : l === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4 })]; }
        case 'blockquote': return blocks(n.content, { ...ctx, quote: true });
        case 'bulletList': return (n.content ?? []).flatMap((li) => blocks(li.content, { ...ctx, list: 'bullet', level: ctx.list ? (ctx.level ?? 0) + 1 : 0 }));
        case 'orderedList': return (n.content ?? []).flatMap((li) => blocks(li.content, { ...ctx, list: 'number', level: ctx.list ? (ctx.level ?? 0) + 1 : 0 }));
        case 'horizontalRule': firstPara = true; return [new Paragraph({ children: [new TextRun(o.sceneSeparator || ' ')], alignment: AlignmentType.CENTER })];
        default: return blocks(n.content, ctx);
      }
    });
  const children: InstanceType<typeof Paragraph>[] = [];
  if (o.titlePage) {
    children.push(new Paragraph({ children: [new TextRun({ text: p.title, size: 52, bold: true })], alignment: AlignmentType.CENTER, spacing: { before: 3600, after: 300 } }));
    if (o.author) children.push(new Paragraph({ children: [new TextRun({ text: `by ${o.author}`, size: 28 })], alignment: AlignmentType.CENTER }));
  }
  parts.forEach((ch, i) => {
    if (o.pageBreaks && (i > 0 || o.titlePage)) children.push(new Paragraph({ children: [new PageBreak()] }));
    if (ch.title) children.push(new Paragraph({ text: ch.title, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 600 } }));
    firstPara = true;
    ch.scenes.forEach((s, j) => {
      if (j > 0) { children.push(new Paragraph({ children: [new TextRun(o.sceneSeparator || ' ')], alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 } })); firstPara = true; }
      children.push(...blocks((withoutDeletions(s.content) as PMNode).content));
    });
  });
  const doc = new Document({
    creator: o.author || 'Writell', title: p.title,
    styles: {
      default: { document: { run: { font: o.font, size: o.size * 2 } } },
      paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 36, font: o.font }, paragraph: { alignment: AlignmentType.CENTER } }],
    },
    numbering: { config: [{ reference: 'num', levels: [0, 1, 2].map((level) => ({ level, format: 'decimal' as const, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) }] },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  const buf = await Packer.toArrayBuffer(doc);
  return saveBinary(`${safeName(p.title)}.docx`, new Uint8Array(buf), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

/* =====================================================================
 * Import a Word document as a new project (headings become chapters)
 * ===================================================================== */

export async function importDocx(): Promise<string | null> {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) return null;
  const mammoth = await import('mammoth');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const level = dom.querySelector('h1') ? 'H1' : dom.querySelector('h2') ? 'H2' : null;
  const chunks: { title: string; html: string }[] = [];
  let cur: { title: string; html: string } | null = null;
  for (const el of Array.from(dom.body.children)) {
    if (level && el.tagName === level) { if (cur) chunks.push(cur); cur = { title: el.textContent?.trim() || 'Untitled', html: '' }; continue; }
    if (!cur) cur = { title: level ? 'Opening' : 'Chapter 1', html: '' };
    cur.html += el.outerHTML;
  }
  if (cur) chunks.push(cur);
  if (!chunks.length) chunks.push({ title: 'Chapter 1', html: '' });

  const pid = uid();
  const t = now();
  const title = file.name.replace(/\.docx$/i, '');
  await db.transaction('rw', db.projects, db.chapters, db.scenes, async () => {
    await db.projects.add({ id: pid, title, description: `Imported from ${file.name}`, color: '#5fa8f5', favorite: false, archived: false, goalWords: 0, createdAt: t, updatedAt: t, openedAt: t });
    for (let i = 0; i < chunks.length; i++) {
      const chId = uid();
      await db.chapters.add({ id: chId, projectId: pid, title: chunks[i].title, summary: '', notes: '', order: i, status: 'draft', color: '', createdAt: t, updatedAt: t });
      // scene breaks: paragraphs containing only *, #, ~ or ***
      const scenesHtml = chunks[i].html.split(/<p>\s*(?:\*\s*\*\s*\*|\*\*\*|#|~|\*)\s*<\/p>/);
      for (let j = 0; j < scenesHtml.length; j++) {
        const content = htmlToJson(scenesHtml[j] || '<p></p>');
        const words = (jsonToText(content).match(/[\p{L}\p{N}’'-]+/gu) ?? []).length;
        await db.scenes.add({ id: uid(), projectId: pid, chapterId: chId, title: `Scene ${j + 1}`, summary: '', notes: '', order: j, status: 'draft', content, words, createdAt: t, updatedAt: t });
      }
    }
  });
  return pid;
}

export const pdfHint = () => (isTauri() ? 'In the print window choose “Microsoft Print to PDF” (or “Save as PDF”) as the printer.' : 'In the print window choose “Save as PDF” as the destination.');
