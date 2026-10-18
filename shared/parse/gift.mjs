// Moodle's GIFT format, the single-answer subset this system marks:
//   multiple choice {=right ~wrong ~wrong}, true/false {T} {F} {TRUE} {FALSE},
//   numerical {#3.14:0.01} or {#1..2}, short answer {=one =two}.
// Titles (::t::), comments (//), format tags ([markdown]) and feedback (#...) are accepted
// and dropped. Weighted or multiple-correct answers are reported, not guessed.

import { makeOptions, needsFixedOptions, trueFalse, validateQuestion } from '../question.mjs';

const ESC = { '~': '\u0001', '=': '\u0002', '#': '\u0003', '{': '\u0004', '}': '\u0005', ':': '\u0006' };
const UNESC = Object.fromEntries(Object.entries(ESC).map(([k, v]) => [v, k]));
const escape = (s) => s.replace(/\\([~=#{}:])/g, (_, c) => ESC[c]);
const unescape = (s) => s.replace(/[\u0001-\u0006]/g, (c) => UNESC[c]).replace(/\\n/g, '\n');
const clean = (s) => unescape(s).replace(/\s+/g, ' ').trim();

function splitAnswers(body) {
  // Each answer starts with = or ~; feedback after # belongs to its answer and is dropped.
  const parts = [];
  const re = /([=~])([^=~]*)/g;
  let m;
  while ((m = re.exec(body))) {
    let t = m[2];
    const hash = t.indexOf('#');
    if (hash >= 0) t = t.slice(0, hash);
    let weight = null;
    const w = /^%(-?\d+(?:\.\d+)?)%/.exec(t.trim());
    if (w) { weight = Number(w[1]); t = t.trim().slice(w[0].length); }
    parts.push({ correct: m[1] === '=', weight, text: clean(t) });
  }
  return parts;
}

function parseBlock(block) {
  let s = escape(block);
  s = s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').trim();
  if (!s) return null;
  if (/^\$CATEGORY:/i.test(s)) return null;
  s = s.replace(/^::.*?::/s, '').trim();
  const open = s.indexOf('{'), close = s.lastIndexOf('}');
  if (open < 0 || close < open) return { error: 'no answer block { … }' };
  const before = s.slice(0, open), after = s.slice(close + 1);
  let stem = clean((before + (after.trim() ? ' _____ ' + after : '')).replace(/^\[(markdown|html|plain|moodle)\]/i, ''));
  const body = s.slice(open + 1, close).trim();

  if (/^(T|TRUE|F|FALSE)(\s*#.*)?$/is.test(body)) {
    const key = /^T/i.test(body);
    return { q: { ...trueFalse(key), stem, source: { import: 'gift' } } };
  }
  if (body.startsWith('#')) {
    const first = body.slice(1).split(/\s*=\s*/)[0].replace(/#.*$/s, '').trim();
    const range = /^(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)$/.exec(first);
    if (range) {
      const lo = Number(range[1]), hi = Number(range[2]);
      return { q: { type: 'numeric', stem, options: [], key: (lo + hi) / 2, tolerance: { abs: (hi - lo) / 2 }, source: { import: 'gift' } } };
    }
    const [v, tol] = first.split(':').map((x) => x?.trim());
    return { q: { type: 'numeric', stem, options: [], key: Number(v), tolerance: { abs: tol ? Number(tol) : 0 }, source: { import: 'gift' } } };
  }
  const answers = splitAnswers(body);
  if (!answers.length) return { error: 'empty answer block' };
  const hasWrong = answers.some((a) => !a.correct && (a.weight === null || a.weight <= 0));
  const corrects = answers.filter((a) => (a.correct && (a.weight === null || a.weight === 100)) || a.weight === 100);
  if (!hasWrong) {
    // Only "=" answers: short answer, each one accepted.
    return { q: { type: 'short', stem, options: [], key: answers[0].text, accepted: answers.slice(1).map((a) => a.text), source: { import: 'gift' } } };
  }
  if (corrects.length !== 1 || answers.some((a) => a.weight !== null && a.weight > 0 && a.weight < 100)) {
    return { error: 'partial-credit or multiple-answer question (only single-answer questions are marked)' };
  }
  const options = makeOptions(answers.map((a) => a.text));
  const key = options[answers.indexOf(corrects[0])].id;
  const q = { type: 'mcq', stem, options, key, source: { import: 'gift' } };
  if (needsFixedOptions(options)) q.fixed_options = true;
  return { q };
}

export function parseGIFT(text) {
  const questions = [];
  const errors = [];
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let line = 1;
  for (const block of src.split(/\n\s*\n/)) {
    const r = parseBlock(block);
    if (r?.error) errors.push({ line, message: r.error });
    else if (r?.q) {
      const problems = validateQuestion(r.q);
      if (problems.length) errors.push({ line, message: problems.join('; ') });
      else questions.push(r.q);
    }
    line += block.split('\n').length + 1;
  }
  return { questions, errors };
}
