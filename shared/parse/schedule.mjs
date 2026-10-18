// CA schedules: rows of (label, page range, topic) — brief §2.2.
// Accepts three shapes:
//   1. a laid-out table (pdftotext -layout, or pdf.js text rebuilt into columns), where a cell
//      may wrap onto the next line, e.g. "Page 43 (second" / "half)-44";
//   2. CSV with a header, e.g. "CA,Pages,Topic";
//   3. one row per line, e.g. "CA1 pp. 6-10 Offer and Acceptance" or "CA6: p. 43 (second half)-44 …".

import { parseCSV, plainPunctuation } from '../text.mjs';

const LABEL = /^(?:CA|Test|Quiz|Week|Wk|Assessment|Q)\s*-?\s*\d{1,3}[a-z]?$/i;
const PART = String.raw`(?:\s*\((first|second)\s+half\))?`;
const RANGE = new RegExp(
  String.raw`(?:pages?|pp?\.?|pg\.?)\s*(\d{1,4})${PART}\s*(?:-|to)\s*(\d{1,4})${PART}` +
  String.raw`|(?:pages?|pp?\.?|pg\.?)\s*(\d{1,4})${PART}` +
  String.raw`|^\s*(\d{1,4})${PART}\s*(?:-|to)\s*(\d{1,4})${PART}\s*$` +
  String.raw`|^\s*(\d{1,4})${PART}\s*$`,
  'i',
);

/** Parses "Pages 6-10", "p. 43 (second half)-44", "65–66", "12" into a page range. */
export function parsePageRange(text) {
  const m = RANGE.exec(plainPunctuation(text).trim());
  if (!m) return null;
  const g = m.slice(1);
  let from, fromPart, to, toPart;
  if (g[0]) [from, fromPart, to, toPart] = [g[0], g[1], g[2], g[3]];
  else if (g[4]) [from, fromPart, to, toPart] = [g[4], g[5], g[4], g[5]];
  else if (g[6]) [from, fromPart, to, toPart] = [g[6], g[7], g[8], g[9]];
  else [from, fromPart, to, toPart] = [g[10], g[11], g[10], g[11]];
  const r = { from: Number(from), to: Number(to) };
  if (r.to < r.from) return null;
  if (fromPart) r.fromPart = `${fromPart.toLowerCase()}-half`;
  if (toPart && g[0]) r.toPart = `${toPart.toLowerCase()}-half`;
  return r;
}

function chunks(line) {
  // Runs of text separated by two or more spaces, with their start columns.
  const out = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(line))) out.push({ start: m.index, text: m[0] });
  return out;
}

function parseLayout(lines) {
  const hi = lines.findIndex((l) => /\bpages?\b/i.test(l) && /\b(topic|area|title|reading|content)\b/i.test(l) && chunks(l).length >= 3);
  if (hi < 0) return null;
  const cols = chunks(lines[hi]).map((c) => c.start);
  const rows = [];
  let cur = null, prevBlank = true;
  for (const line of lines.slice(hi + 1)) {
    if (!line.trim()) { prevBlank = true; continue; }
    const cs = chunks(line);
    const cells = cols.map(() => []);
    for (const c of cs) {
      let k = 0;
      for (let i = 0; i < cols.length; i++) if (c.start >= cols[i] - 2) k = i;
      cells[k].push(c.text);
    }
    const label = cells[0].join(' ');
    if (LABEL.test(label)) {
      cur = { label, cells: cells.map((c) => c.join(' ')) };
      rows.push(cur);
    } else if (cur && !prevBlank && !label) {
      cells.forEach((c, i) => { if (c.length) cur.cells[i] = `${cur.cells[i]} ${c.join(' ')}`.trim(); });
    } else if (cur && prevBlank) {
      cur = null; // a blank line ends a row; later text is a note or footer
    }
    prevBlank = false;
  }
  return rows.map((r) => {
    const pageCell = r.cells[1] ?? '';
    const topic = r.cells.slice(2).join(' ').replace(/\s+/g, ' ').trim();
    return { label: r.label.replace(/\s+/g, ''), pagesText: pageCell, range: parsePageRange(pageCell), topic };
  });
}

function parseCSVSchedule(text) {
  const rows = parseCSV(text);
  if (rows.length < 2 || rows[0].length < 3) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const ip = header.findIndex((h) => /page/.test(h));
  if (ip < 0) return null;
  const il = ip === 0 ? 1 : 0;
  const it = header.findIndex((h, i) => i !== ip && i !== il);
  return rows.slice(1).map((r) => ({
    label: (r[il] ?? '').trim(), pagesText: (r[ip] ?? '').trim(), range: parsePageRange(r[ip] ?? ''), topic: (r[it] ?? '').trim(),
  }));
}

function parseLines(lines) {
  const rows = [];
  for (const line of lines) {
    const m = /^\s*((?:CA|Test|Quiz|Week|Wk|Assessment|Q)\s*-?\s*\d{1,3}[a-z]?)\s*[:.\-–]?\s*(.+)$/i.exec(plainPunctuation(line));
    if (!m) continue;
    const rest = m[2];
    const rm = /((?:pages?|pp?\.?|pg\.?)\s*\d{1,4}(?:\s*\((?:first|second)\s+half\))?(?:\s*(?:-|to)\s*\d{1,4}(?:\s*\((?:first|second)\s+half\))?)?)/i.exec(rest);
    if (!rm) continue;
    const topic = (rest.slice(0, rm.index) + ' ' + rest.slice(rm.index + rm[0].length)).replace(/^[\s:,\-–]+|[\s:,\-–]+$/g, '').replace(/\s+/g, ' ');
    rows.push({ label: m[1].replace(/\s+/g, ''), pagesText: rm[0], range: parsePageRange(rm[0]), topic });
  }
  return rows;
}

/** Returns { rows: [{label, pagesText, range: {from, to, fromPart?, toPart?} | null, topic}], format }. */
export function parseSchedule(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const layout = parseLayout(lines);
  if (layout && layout.length) return { rows: layout, format: 'layout' };
  const csv = src.includes(',') ? parseCSVSchedule(src) : null;
  if (csv && csv.length && csv.every((r) => r.range)) return { rows: csv, format: 'csv' };
  return { rows: parseLines(lines), format: 'lines' };
}
