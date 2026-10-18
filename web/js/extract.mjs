// Turns what a lecturer sends (brief §2.1) into pages of text: PDFs (text layer, page labels),
// scans and phone photos (scaled to at most 1,600 px and sent for transcription), DOCX (headings
// kept), LaTeX, Markdown and plain text. Word and source files have no fixed pages, so they are
// split at page-break commands, else at top-level headings, else into blocks of about 12,000
// characters at paragraph boundaries.

const MAX_SIDE = 1600;
const CHUNK = 12_000;

let pdfjsLoading = null;
export function pdfjs() {
  pdfjsLoading ??= import('../vendor/pdfjs/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return m;
  });
  return pdfjsLoading;
}

let mammothLoading = null;
function mammoth() {
  mammothLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/mammoth/mammoth.browser.min.js', import.meta.url).href;
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => reject(new Error('could not load the Word reader'));
    document.head.append(s);
  });
  return mammothLoading;
}

export function kindOf(file) {
  const n = file.name.toLowerCase();
  if ((file.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(n)) return 'photo';
  if (n.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.tex')) return 'tex';
  if (/\.(md|markdown)$/.test(n)) return 'md';
  if (n.endsWith('.txt') || (file.type || '').startsWith('text/')) return 'txt';
  return null;
}

// ---------------------------------------------------------------- PDF

/** Rebuilds reading text from pdf.js items: lines by baseline, paragraphs from larger gaps. */
export function pageText(content) {
  const lines = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string') continue;
    const [, , , d, x, y] = it.transform;
    const size = Math.abs(d) || it.height || 10;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < size * 0.5) last.parts.push({ x, s: it.str, w: it.width });
    else lines.push({ y, size, parts: [{ x, s: it.str, w: it.width }] });
  }
  let out = '';
  let prev = null;
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const p of l.parts) {
      if (end !== null && p.x - end > l.size * 0.15 && !text.endsWith(' ') && !p.s.startsWith(' ')) text += ' ';
      text += p.s;
      end = p.x + (p.w ?? 0);
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (prev) out += prev.y - l.y > prev.size * 1.9 ? '\n\n' : '\n';
    out += text;
    prev = l;
  }
  return out;
}

/** The page laid out in fixed-width columns, like `pdftotext -layout` (for CA-schedule tables). */
export function layoutText(content) {
  const widths = content.items.filter((i) => i.str?.trim() && i.width > 0).map((i) => i.width / i.str.length).sort((a, b) => a - b);
  const cw = widths.length ? widths[Math.floor(widths.length / 2)] : 5;
  const rows = [];
  for (const it of content.items) {
    if (!it.str?.trim()) continue;
    const [, , , d, x, y] = it.transform;
    const size = Math.abs(d) || 10;
    let r = rows.find((row) => Math.abs(row.y - y) < size * 0.5);
    if (!r) rows.push((r = { y, size, items: [] }));
    r.items.push({ col: Math.round(x / cw), s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  const out = [];
  let prev = null;
  for (const r of rows) {
    if (prev && prev.y - r.y > prev.size * 1.9) out.push('');
    r.items.sort((a, b) => a.col - b.col);
    let line = '';
    for (const it of r.items) {
      if (line.length < it.col) line = line.padEnd(it.col, ' ');
      else if (line && !line.endsWith(' ')) line += '  ';
      line += it.s;
    }
    out.push(line);
    prev = r;
  }
  return out.join('\n');
}

async function canvasToJpeg(canvas) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), url: URL.createObjectURL(blob), bytes: buf.length };
}

async function pdfPages(file, onProgress) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const labels = await doc.getPageLabels().catch(() => null);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress?.(`Reading page ${n} of ${doc.numPages}`);
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = pageText(content);
    const label = labels?.[n - 1];
    const printed = label && /^\d+$/.test(label) ? Number(label) : undefined;
    if (text.replace(/\s/g, '').length >= 40) {
      pages.push({ text, printed });
    } else {
      // A scan (e.g. CamScanner): render the page for transcription.
      const v1 = page.getViewport({ scale: 1 });
      const scale = MAX_SIDE / Math.max(v1.width, v1.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
      pages.push({ text: '', printed, image: await canvasToJpeg(canvas) });
    }
  }
  return pages;
}

/** The first page of a PDF as layout text (for a CA schedule sent as a PDF). */
export async function pdfLayoutText(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const parts = [];
  for (let n = 1; n <= Math.min(doc.numPages, 5); n++) parts.push(layoutText(await (await doc.getPage(n)).getTextContent()));
  return parts.join('\n\n');
}

// ---------------------------------------------------------------- photos

export async function photoPage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${file.name}: this browser cannot read the image (HEIC photos need converting to JPEG first)`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { text: '', image: await canvasToJpeg(canvas) };
}

// ---------------------------------------------------------------- unpaged sources

export function splitPages(text) {
  const t = text.replace(/\r\n?/g, '\n').trim();
  let parts = t.includes('\f') ? t.split('\f') : null;
  if (!parts) {
    const at = [...t.matchAll(/^# .+$/gm)].map((m) => m.index).filter((i) => i > 0);
    parts = at.length ? [0, ...at].map((s, i, a) => t.slice(s, a[i + 1] ?? t.length)) : [t];
  }
  const out = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (p.length <= CHUNK) { out.push(p); continue; }
    let cur = '';
    for (const para of p.split(/\n\s*\n/)) {
      if (cur && cur.length + para.length > CHUNK) { out.push(cur.trim()); cur = ''; }
      cur += `${para}\n\n`;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.map((text) => ({ text }));
}

export function texToText(src) {
  let s = src.replace(/(^|[^\\])%.*$/gm, '$1');
  const body = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(s);
  if (body) s = body[1];
  const level = { part: '#', chapter: '#', section: '#', subsection: '##', subsubsection: '###', paragraph: '###' };
  s = s.replace(/\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, (_, c, t) => `\n\n${level[c]} ${t}\n\n`)
    .replace(/\\(newpage|clearpage|pagebreak|cleardoublepage)\b/g, '\f')
    .replace(/\\item(?:\[([^\]]*)\])?\s*/g, (_, l) => `\n- ${l ? `${l} ` : ''}`)
    .replace(/\\(begin|end)\{(itemize|enumerate|description|center|flushleft|flushright|quote|quotation|minipage|figure|table)\}(\[[^\]]*\])?/g, '\n')
    .replace(/\\(textbf|textit|emph|underline|textsc|texttt|text|mbox)\{([^{}]*)\}/g, '$2')
    .replace(/\\(label|ref|eqref|cite|index|footnote|caption|includegraphics)(\[[^\]]*\])?\{[^{}]*\}/g, '')
    .replace(/\\\\(\[[^\]]*\])?/g, '\n')
    .replace(/(?<!\\)~/g, ' ')
    .replace(/\\(maketitle|tableofcontents|noindent|centering|par|medskip|bigskip|smallskip|hfill|vfill)\b/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

async function docxText(file) {
  const m = await mammoth();
  const { value } = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(value, 'text/html');
  const out = [];
  for (const el of doc.body.children) {
    const t = el.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (/^H1$/.test(el.tagName)) out.push(`# ${t}`);
    else if (/^H2$/.test(el.tagName)) out.push(`## ${t}`);
    else if (/^H[3-6]$/.test(el.tagName)) out.push(`### ${t}`);
    else if (/^(UL|OL)$/.test(el.tagName)) out.push([...el.querySelectorAll('li')].map((li) => `- ${li.textContent.replace(/\s+/g, ' ').trim()}`).join('\n'));
    else if (el.tagName === 'TABLE') out.push([...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()).join(' | ')).join('\n'));
    else out.push(t);
  }
  return out.join('\n\n');
}

/** { kind, name, pages: [{ text, printed?, image? }] } — pages with an image need transcription. */
export async function extractFile(file, onProgress) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name}: send a PDF, Word (.docx), LaTeX, Markdown, text file or a photo`);
  if (kind === 'photo') return { kind, name: file.name, pages: [await photoPage(file)] };
  if (kind === 'pdf') return { kind, name: file.name, pages: await pdfPages(file, onProgress) };
  if (kind === 'docx') return { kind, name: file.name, pages: splitPages(await docxText(file)) };
  const text = await file.text();
  return { kind, name: file.name, pages: splitPages(kind === 'tex' ? texToText(text) : text) };
}

/** Plain text of a file, for pasting into the Question Pool. */
export async function fileText(file) {
  const kind = kindOf(file);
  if (kind === 'docx') return docxText(file);
  if (kind === 'pdf') return (await pdfPages(file)).map((p) => p.text).join('\n\n');
  return file.text();
}
