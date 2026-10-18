// CSV for spreadsheets (brief §7.5): UTF-8 with BOM, CRLF line endings, RFC 4180
// quoting, and a leading apostrophe on any cell a spreadsheet could read as a formula.

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * columns: [{ key, header }] in output order; rows: objects keyed by column key.
 * Returns the full file contents as a string, starting with a BOM.
 */
export function toCSV(columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
