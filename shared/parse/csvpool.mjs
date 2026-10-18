// Question pools as CSV with a header row. Recognized columns (any case):
//   question | stem; a..e | option a..e | option_a..option_e; answer | key | correct;
//   type (mcq, tf, numeric, short); tolerance; explanation.
// The answer may be a letter, the text of an option, true/false, or a number.

import { parseCSV } from '../text.mjs';
import { makeOptions, needsFixedOptions, trueFalse, validateQuestion } from '../question.mjs';

const norm = (h) => h.trim().toLowerCase().replace(/[\s_]+/g, ' ');

export function parseCSVPool(text) {
  const rows = parseCSV(text);
  const questions = [];
  const errors = [];
  if (rows.length < 2) return { questions, errors: [{ line: 1, message: 'a header row and at least one question are needed' }] };
  const header = rows[0].map(norm);
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const iq = col('question', 'stem', 'question text');
  const ians = col('answer', 'key', 'correct', 'correct answer');
  const itype = col('type');
  const itol = col('tolerance');
  const iexp = col('explanation');
  const optCols = 'abcdefghij'.split('').map((l) => col(l, `option ${l}`, `opt ${l}`)).filter((i) => i >= 0);
  if (iq < 0 || ians < 0) return { questions, errors: [{ line: 1, message: 'the header needs a question column and an answer column' }] };

  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const stem = (r[iq] ?? '').trim();
    const ans = (r[ians] ?? '').trim();
    const type = itype >= 0 ? (r[itype] ?? '').trim().toLowerCase() : '';
    const texts = optCols.map((i) => (r[i] ?? '').trim()).filter(Boolean);
    let q;
    if (type === 'tf' || (!type && !texts.length && /^(true|false|t|f)$/i.test(ans))) {
      q = { ...trueFalse(/^t/i.test(ans)), stem };
    } else if (type === 'numeric' || (!type && !texts.length && /^-?[\d.]+$/.test(ans))) {
      q = { type: 'numeric', stem, options: [], key: Number(ans), tolerance: { abs: itol >= 0 ? Number(r[itol] || 0) : 0 } };
    } else if (type === 'short' || (!type && !texts.length)) {
      const [key, ...accepted] = ans.split('|').map((s) => s.trim()).filter(Boolean);
      q = { type: 'short', stem, options: [], key, accepted };
    } else {
      const options = makeOptions(texts);
      let key = null;
      if (/^[A-J]$/i.test(ans) && ans.toUpperCase().charCodeAt(0) - 65 < options.length) key = options[ans.toUpperCase().charCodeAt(0) - 65].id;
      else key = options.find((o) => o.text.toLowerCase() === ans.toLowerCase())?.id ?? null;
      q = { type: 'mcq', stem, options, key };
      if (needsFixedOptions(options)) q.fixed_options = true;
    }
    if (iexp >= 0 && r[iexp]?.trim()) q.explanation = r[iexp].trim();
    q.source = { import: 'csv' };
    const problems = validateQuestion(q);
    if (problems.length) errors.push({ line, message: problems.join('; ') });
    else questions.push(q);
  });
  return { questions, errors };
}
