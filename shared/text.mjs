// Text helpers shared by the parsers, the notes model and the grounding check.

/** Unicode-normalizes punctuation that varies between sources (curly quotes, dashes, NBSP). */
export function plainPunctuation(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/­/g, '');
}

/** Lowercase, plain punctuation, de-hyphenated line breaks, single spaces. */
export function normalizeForMatch(s) {
  return plainPunctuation(s)
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words only: letters and digits, lowercase, no accents. */
export function words(s) {
  return plainPunctuation(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Character trigrams of the normalized word sequence. */
export function trigrams(s) {
  const t = ` ${words(s).join(' ')} `;
  const out = new Set();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** RFC 4180 CSV reader: returns an array of rows (arrays of strings). Accepts LF or CRLF and a BOM. */
export function parseCSV(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' && s[i + 1] === '\n') i++;
    if (c === '\n' || c === '\r') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}
