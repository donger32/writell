import { generateHTML, type JSONContent } from '@tiptap/core';
import { db, uid, now, type Project } from './db';
import { baseExtensions, jsonToMarkdown, jsonToText, htmlToJson, withoutDeletions } from './editor/extensions';
import { safeName, saveFile, saveBinary } from './util';
import { isTauri } from './platform';

/* =====================================================================
 * Manuscript export with formatting options (Markdown, TXT, Word, PDF, EPUB ebook)
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

export async function exportManuscript(projectId: string, format: 'md' | 'txt' | 'docx' | 'pdf' | 'epub', o: ExportOptions) {
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
  if (format === 'epub') return exportEpub(p, parts, o);
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


/* ---------- EPUB ebook (for phones, e-readers, Kindle via Send to Kindle, Apple Books…) ---------- */

/** HTML from the editor, made into well-formed XHTML (what ebook readers require) */
function toXhtml(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // review marks and comments are for writing, not for readers
  doc.querySelectorAll('span[data-comment], span[data-flag], mark[data-comment]').forEach((el) => el.replaceWith(...Array.from(el.childNodes)));
  const ser = new XMLSerializer();
  return Array.from(doc.body.childNodes).map((n) => ser.serializeToString(n).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')).join('\n');
}
const xesc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const page = (title: string, body: string, lang: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${xesc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;

async function exportEpub(p: Project, parts: { title: string; scenes: { content: unknown }[] }[], o: ExportOptions) {
  const { default: JSZip } = await import('jszip');
  const ext = baseExtensions();
  const lang = 'en';
  const id = `urn:uuid:${p.id.replace(/[^a-z0-9-]/gi, '') || uid()}`;
  const zip = new JSZip();
  // the mimetype file must come first and be stored uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file('OEBPS/style.css', `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1 { text-align: center; font-weight: normal; font-size: 1.5em; margin: 2em 0 1.5em; page-break-before: always; }
p { margin: 0 0 ${o.indentParagraphs ? '0' : '0.8em'}; ${o.indentParagraphs ? 'text-indent: 1.5em;' : ''} }
h1 + p, .sep + p, h2 + p, h3 + p, blockquote + p { text-indent: 0; }
.sep { text-align: center; text-indent: 0; margin: 1em 0; }
blockquote { margin: 0 1.5em; font-style: italic; }
.title { text-align: center; margin-top: 30%; } .title h1 { page-break-before: auto; font-size: 2em; margin: 0 0 0.6em; } .title p { text-indent: 0; font-size: 1.1em; }
.cover { text-align: center; margin: 0; padding: 0; } .cover img { max-width: 100%; max-height: 100%; }`);

  const items: { id: string; href: string; type: string; props?: string; linear?: boolean }[] = [];
  const toc: { title: string; href: string }[] = [];
  // a cover picture, if the project has one
  if (p.coverImage?.startsWith('data:image/')) {
    const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.*)$/.exec(p.coverImage);
    if (m) {
      const ext2 = m[2] === 'jpeg' ? 'jpg' : m[2];
      zip.file(`OEBPS/cover.${ext2}`, m[3], { base64: true });
      items.push({ id: 'cover-image', href: `cover.${ext2}`, type: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], props: 'cover-image' });
      zip.file('OEBPS/cover.xhtml', page('Cover', `<div class="cover"><img src="cover.${ext2}" alt="${xesc(p.title)}"/></div>`, lang));
      items.push({ id: 'cover', href: 'cover.xhtml', type: 'application/xhtml+xml', linear: true });
    }
  }
  if (o.titlePage) {
    zip.file('OEBPS/title.xhtml', page(p.title, `<div class="title"><h1>${xesc(p.title)}</h1>${o.author ? `<p>by ${xesc(o.author)}</p>` : ''}</div>`, lang));
    items.push({ id: 'title', href: 'title.xhtml', type: 'application/xhtml+xml' });
  }
  parts.forEach((ch, i) => {
    const href = `chapter-${i + 1}.xhtml`;
    const sep = `<p class="sep">${xesc(o.sceneSeparator) || '&#160;'}</p>`;
    const body = ch.scenes.map((s) => toXhtml(generateHTML(withoutDeletions(s.content) as JSONContent, ext))).filter((x) => x.trim()).join(sep);
    const name = ch.title || `Chapter ${i + 1}`;
    zip.file(`OEBPS/${href}`, page(name, `<section epub:type="chapter">${ch.title ? `<h1>${xesc(ch.title)}</h1>` : ''}\n${body}</section>`, lang));
    items.push({ id: `ch${i + 1}`, href, type: 'application/xhtml+xml' });
    toc.push({ title: name, href });
  });
  zip.file('OEBPS/nav.xhtml', page('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${toc.map((t) => `<li><a href="${t.href}">${xesc(t.title)}</a></li>`).join('')}</ol></nav>`, lang));
  // the older table of contents, for older readers
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${xesc(p.title)}</text></docTitle>
<navMap>${toc.map((t, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${xesc(t.title)}</text></navLabel><content src="${t.href}"/></navPoint>`).join('')}</navMap></ncx>`);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${xesc(p.title)}</dc:title>
    ${o.author ? `<dc:creator>${xesc(o.author)}</dc:creator>` : ''}
    <dc:language>${lang}</dc:language>
    ${p.description ? `<dc:description>${xesc(p.description)}</dc:description>` : ''}
    <meta property="dcterms:modified">${modified}</meta>
    ${items.some((x) => x.id === 'cover-image') ? '<meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${items.map((x) => `<item id="${x.id}" href="${x.href}" media-type="${x.type}"${x.props ? ` properties="${x.props}"` : ''}/>`).join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${items.filter((x) => x.type === 'application/xhtml+xml').map((x) => `<itemref idref="${x.id}"/>`).join('\n    ')}
  </spine>
</package>`);
  const bytes = await zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
  return saveBinary(`${safeName(p.title)}.epub`, bytes, 'application/epub+zip');
}
