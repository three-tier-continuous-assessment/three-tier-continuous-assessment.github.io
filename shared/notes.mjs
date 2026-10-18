// The notes model (brief §2.1): pages with printed numbers, paragraphs, headings and
// selections. Converters in the browser turn every source (PDF, photo transcript, DOCX,
// LaTeX, Markdown, text) into pages of plain text with Markdown-style "#" headings.

import { sha256Hex } from './sha256.mjs';
import { normalizeForMatch } from './text.mjs';

/**
 * Numbers a course's pages across its files, in order.
 * files: [{ id, name, firstPage = 1, pages: [{ text, printed? }] }]
 * A page's number is its printed number when known, else firstPage + index.
 */
export function numberPages(files) {
  const pages = [];
  const where = new Map();
  const warnings = [];
  for (const f of files) {
    const first = Number.isInteger(f.firstPage) ? f.firstPage : 1;
    f.pages.forEach((p, i) => {
      const number = Number.isInteger(p.printed) ? p.printed : first + i;
      if (where.has(number)) warnings.push(`page ${number} appears in both "${where.get(number)}" and "${f.name}"`);
      where.set(number, f.name);
      pages.push({ fileId: f.id, index: i, number, text: p.text, hash: sha256Hex(p.text) });
    });
  }
  return { pages, warnings };
}

/** Paragraphs of a text, split at blank lines: [{ start, end, text }]. */
export function paragraphs(text) {
  const out = [];
  const sep = /\n[ \t]*(?:\n[ \t]*)+/g;
  let last = 0, m;
  const push = (a, b) => {
    const seg = text.slice(a, b);
    const s = a + (seg.length - seg.trimStart().length);
    const e = a + seg.trimEnd().length;
    if (e > s) out.push({ start: s, end: e, text: text.slice(s, e) });
  };
  while ((m = sep.exec(text))) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, text.length);
  return out;
}

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const NUMBERED_HEADING = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\p{Lu}[^\n]{2,90})$/u;
const CAPS_HEADING = /^(?=.*\p{Lu})[\p{Lu}\d][\p{Lu}\d\s,:;&()'\-–]{3,80}$/u;

/** Headings on one page: [{ offset, level, title }]. */
export function detectHeadings(text) {
  const out = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    let m;
    if ((m = MD_HEADING.exec(t))) out.push({ offset, level: m[1].length, title: m[2] });
    else if ((m = NUMBERED_HEADING.exec(t)) && !/[.;,]$/.test(t)) out.push({ offset, level: m[1].split('.').length, title: t });
    else if (CAPS_HEADING.test(t) && t.split(/\s+/).length <= 10 && !/[.;,]$/.test(t)) out.push({ offset, level: 1, title: t });
    offset += line.length + 1;
  }
  return out;
}

/** All headings of a course, in reading order: [{ page, offset, level, title }]. */
export function courseHeadings(pages) {
  return pages.flatMap((p) => detectHeadings(p.text).map((h) => ({ page: p.number, ...h })));
}

function findAnchor(text, anchor) {
  const want = normalizeForMatch(anchor);
  if (!want) return null;
  return paragraphs(text).find((p) => normalizeForMatch(p.text).startsWith(want)) ?? null;
}

/**
 * Resolves a selection to [start, end) positions.
 * spec: { kind: 'pages', from, to, startAnchor?, endAnchor?, fromPart?, toPart? }
 *     | { kind: 'headings', first: index, last: index }   (indices into courseHeadings)
 * fromPart 'second-half' starts at the first paragraph in the second half of the page;
 * toPart 'first-half' ends with the last paragraph that starts in the first half.
 * Returns { ok: true, start: {page, offset}, end: {page, offset} } or { ok: false, error }.
 */
export function resolveSelection(pages, spec) {
  const byNumber = new Map(pages.map((p) => [p.number, p]));
  if (spec.kind === 'headings') {
    const hs = courseHeadings(pages);
    const a = hs[spec.first], b = hs[spec.last];
    if (!a || !b || spec.last < spec.first) return { ok: false, error: 'choose a first and a last heading, in order' };
    const next = hs.slice(spec.last + 1).find((h) => h.level <= b.level);
    const lastPage = pages[pages.length - 1];
    return {
      ok: true,
      start: { page: a.page, offset: a.offset },
      end: next ? { page: next.page, offset: next.offset } : { page: lastPage.number, offset: lastPage.text.length },
    };
  }
  const from = byNumber.get(spec.from), to = byNumber.get(spec.to);
  if (!from) return { ok: false, error: `page ${spec.from} is not in the notes` };
  if (!to) return { ok: false, error: `page ${spec.to} is not in the notes` };
  if (pages.indexOf(to) < pages.indexOf(from)) return { ok: false, error: 'the last page comes before the first' };

  let start = 0;
  if (spec.startAnchor) {
    const p = findAnchor(from.text, spec.startAnchor);
    if (!p) return { ok: false, error: `no paragraph on page ${from.number} starts with "${spec.startAnchor}"` };
    start = p.start;
  } else if (spec.fromPart === 'second-half') {
    const ps = paragraphs(from.text);
    const half = from.text.length / 2;
    start = (ps.find((p) => p.start >= half) ?? ps[ps.length - 1] ?? { start: 0 }).start;
  }

  let end = to.text.length;
  if (spec.endAnchor) {
    const p = findAnchor(to.text, spec.endAnchor);
    if (!p) return { ok: false, error: `no paragraph on page ${to.number} starts with "${spec.endAnchor}"` };
    end = p.end;
  } else if (spec.toPart === 'first-half') {
    const ps = paragraphs(to.text);
    const half = to.text.length / 2;
    const inFirst = ps.filter((p) => p.start < half);
    end = (inFirst[inFirst.length - 1] ?? ps[0] ?? { end: 0 }).end;
  }
  if (from === to && end <= start) return { ok: false, error: 'the selection is empty' };
  return { ok: true, start: { page: from.number, offset: start }, end: { page: to.number, offset: end } };
}

/** The selected text: { segments: [{ number, text, hash }], text } with "[page n]" markers. */
export function extractSelection(pages, sel) {
  const i0 = pages.findIndex((p) => p.number === sel.start.page);
  const i1 = pages.findIndex((p) => p.number === sel.end.page);
  const segments = [];
  for (let i = i0; i <= i1; i++) {
    const p = pages[i];
    const a = i === i0 ? sel.start.offset : 0;
    const b = i === i1 ? sel.end.offset : p.text.length;
    const text = p.text.slice(a, b).trim();
    if (text) segments.push({ number: p.number, text, hash: p.hash });
  }
  return { segments, text: segments.map((s) => `[page ${s.number}]\n${s.text}`).join('\n\n') };
}
