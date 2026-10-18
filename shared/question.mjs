// The canonical question shape and its validation (brief §2.6). Parsers and the
// generator both produce this shape; the Worker stores it.
//
// { type: 'mcq'|'tf'|'numeric'|'short', stem, options: [{id, text}], key,
//   tolerance?: {abs?, rel?}, accepted?: [string], explanation?, difficulty?, marks?,
//   fixed_options?, source? }

import { trigrams, jaccard } from './text.mjs';

export const OPTION_IDS = 'abcdefghij'.split('');

export function makeOptions(texts) {
  return texts.map((text, i) => ({ id: OPTION_IDS[i], text: String(text).trim() }));
}

export function trueFalse(key) {
  return {
    type: 'tf',
    options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }],
    key: key ? 'true' : 'false',
    fixed_options: true,
  };
}

/** Options that must keep their position, e.g. "All of the above". */
export function needsFixedOptions(options) {
  return options.some((o) => /\b(all|none|both|neither) of the (above|options|preceding)\b/i.test(o.text));
}

/** Returns a list of problems; an empty list means the question is well-formed. */
export function validateQuestion(q) {
  const errors = [];
  if (!q || typeof q !== 'object') return ['not an object'];
  if (!['mcq', 'tf', 'numeric', 'short'].includes(q.type)) errors.push(`unknown type ${q.type}`);
  if (!q.stem || !String(q.stem).trim()) errors.push('empty question');
  if (q.type === 'mcq' || q.type === 'tf') {
    const opts = q.options ?? [];
    if (opts.length < 2) errors.push('fewer than two options');
    const texts = opts.map((o) => String(o.text).trim().toLowerCase());
    if (new Set(texts).size !== texts.length) errors.push('two options are the same');
    if (texts.some((t) => !t)) errors.push('an option is empty');
    if (!opts.some((o) => o.id === q.key)) errors.push('the key is not one of the options');
  }
  if (q.type === 'numeric' && !Number.isFinite(Number(q.key))) errors.push('the key is not a number');
  if (q.type === 'short' && !String(q.key ?? '').trim()) errors.push('no accepted answer');
  return errors;
}

/** Index of the first pool stem the candidate nearly duplicates (trigram Jaccard >= threshold), or -1. */
export function nearDuplicateIndex(stem, poolStems, threshold = 0.8) {
  const t = trigrams(stem);
  for (let i = 0; i < poolStems.length; i++) if (jaccard(t, trigrams(poolStems[i])) >= threshold) return i;
  return -1;
}
