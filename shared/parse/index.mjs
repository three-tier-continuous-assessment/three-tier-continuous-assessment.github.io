// Picks the parser for an uploaded or pasted question pool (brief §2.4).

import { parseAiken } from './aiken.mjs';
import { parseGIFT } from './gift.mjs';
import { parseCSVPool } from './csvpool.mjs';
import { parseNumbered } from './numbered.mjs';

export function detectFormat(text, filename = '') {
  const name = filename.toLowerCase();
  if (name.endsWith('.gift')) return 'gift';
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.json')) return 'json';
  const t = String(text);
  if (/^\s*[[{]/.test(t) && /"stem"|"question"/.test(t)) return 'json';
  if (/\{[^}]*[=~#][^}]*\}|\{\s*(T|F|TRUE|FALSE)\s*\}/.test(t)) return 'gift';
  const first = t.split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (/,/.test(first) && /question|stem/i.test(first) && /answer|key|correct/i.test(first)) return 'csv';
  // Numbered stems ("1.", "2)", "Q3.") mark a typed paper even when it uses "Answer:" lines.
  if (/^\s*(?:Q(?:uestion)?\s*)?\d{1,3}\s*[.):]/im.test(t)) return 'numbered';
  if (/^\s*ANSWER\s*:\s*[A-J]\s*$/im.test(t)) return 'aiken';
  return 'numbered';
}

function parseJSON(text) {
  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.questions;
    if (!Array.isArray(list)) return { questions: [], errors: [{ line: 1, message: 'expected an array of questions' }] };
    return { questions: list.map((q) => ({ ...q, source: { import: 'json' } })), errors: [] };
  } catch (e) {
    return { questions: [], errors: [{ line: 1, message: `not valid JSON: ${e.message}` }] };
  }
}

export function parsePool(text, filename = '') {
  const format = detectFormat(text, filename);
  const parser = { aiken: parseAiken, gift: parseGIFT, csv: parseCSVPool, numbered: parseNumbered, json: parseJSON }[format];
  return { format, ...parser(text) };
}
