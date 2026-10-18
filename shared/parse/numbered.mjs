// Typed question papers, as extracted from DOCX, PDF or plain text:
//   1. Question text            (also "1)", "Q1.", "Question 1:")
//   A. option   (also "A)", "(a)", "a.", "a)"; several options may share one line)
//   Answer: B   (also "Ans: B", "Correct answer - B", "Key: B")

import { makeOptions, needsFixedOptions, validateQuestion } from '../question.mjs';

const QSTART = /^(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.):\-]\s*(.*)$/i;
const OPT = /^\(?([A-Ja-j])[.)]\s*(.+)$/;
const ANS = /^(?:correct\s+answer|answer|ans|key)\s*[:\-–.]?\s*\(?([A-Ja-j])\)?\.?\s*$/i;
const INLINE_SPLIT = /\s{2,}(?=\(?[B-Jb-j][.)]\s)|\s(?=\(?[B-J][.)]\s)/;

function splitOptionLine(line) {
  // "A. foo   B. bar   C. baz" -> ["A. foo", "B. bar", "C. baz"]
  return line.split(INLINE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

export function parseNumbered(text) {
  const questions = [];
  const errors = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let cur = null;

  const finish = () => {
    if (!cur) return;
    const options = makeOptions(cur.options.map((o) => o.text));
    let key = null;
    if (cur.answer) {
      const at = cur.options.findIndex((o) => o.letter === cur.answer);
      key = at >= 0 ? options[at].id : null;
    }
    const q = { type: 'mcq', stem: cur.stem.join(' ').replace(/\s+/g, ' ').trim(), options, key, source: { import: 'numbered' } };
    if (needsFixedOptions(options)) q.fixed_options = true;
    const problems = validateQuestion(q);
    if (problems.length) {
      errors.push({ line: cur.line, number: cur.number, message: problems.join('; '), draft: q });
    } else questions.push(q);
    cur = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.replace(/\t/g, '  ').trim();
    if (!line) return;
    const ans = ANS.exec(line);
    if (ans && cur) { cur.answer = ans[1].toUpperCase(); return; }
    const qs = QSTART.exec(line);
    if (qs && (!cur || cur.options.length || cur.answer)) {
      finish();
      cur = { number: Number(qs[1]), line: idx + 1, stem: [qs[2]], options: [], answer: null };
      // Options on the question's own line: "2) The unit is:  A. newton   B. pascal …"
      const inline = /(?:^|\s)(\(?[Aa][.)]\s.*)$/.exec(qs[2]);
      if (inline && /\s\(?[Bb][.)]\s/.test(inline[1])) {
        const opts = splitOptionLine(inline[1].trim()).map((p) => OPT.exec(p));
        if (opts.every(Boolean)) {
          cur.stem = [qs[2].slice(0, inline.index).trim()];
          for (const o of opts) cur.options.push({ letter: o[1].toUpperCase(), text: o[2].trim() });
        }
      }
      return;
    }
    if (!cur) return;
    const pieces = splitOptionLine(line);
    const opts = pieces.map((p) => OPT.exec(p));
    if (opts.length && opts.every(Boolean)) {
      for (const o of opts) cur.options.push({ letter: o[1].toUpperCase(), text: o[2].trim() });
      return;
    }
    if (cur.options.length) cur.options[cur.options.length - 1].text += ' ' + line;
    else cur.stem.push(line);
  });
  finish();
  return { questions, errors };
}
