// Moodle's Aiken format: the question, lettered options ("A." or "A)"), then "ANSWER: X".

import { makeOptions, needsFixedOptions, validateQuestion } from '../question.mjs';

const OPTION = /^([A-J])[.)]\s+(.+)$/;
const ANSWER = /^ANSWER\s*:\s*([A-J])\s*$/i;

export function parseAiken(text) {
  const questions = [];
  const errors = [];
  let stem = [], letters = [], texts = [], startLine = 0;
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);

  const reset = () => { stem = []; letters = []; texts = []; };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const a = ANSWER.exec(line);
    if (a) {
      const at = letters.indexOf(a[1].toUpperCase());
      const options = makeOptions(texts);
      const q = { type: 'mcq', stem: stem.join(' ').trim(), options, key: at >= 0 ? options[at].id : null, source: { import: 'aiken' } };
      if (needsFixedOptions(options)) q.fixed_options = true;
      const problems = validateQuestion(q);
      if (problems.length) errors.push({ line: startLine + 1, message: problems.join('; ') });
      else questions.push(q);
      reset();
      return;
    }
    const o = OPTION.exec(line);
    if (o && stem.length) {
      letters.push(o[1]);
      texts.push(o[2]);
      return;
    }
    if (letters.length) {
      // Text after options without an ANSWER line: report and start again.
      errors.push({ line: startLine + 1, message: 'options without an ANSWER line' });
      reset();
    }
    if (!stem.length) startLine = idx;
    stem.push(line);
  });
  if (stem.length || letters.length) errors.push({ line: startLine + 1, message: 'question without an ANSWER line' });
  return { questions, errors };
}
