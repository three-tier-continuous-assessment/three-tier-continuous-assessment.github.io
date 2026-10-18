// Deterministic checks on generated questions (brief §2.3): the supporting quote must be in
// the selected text on the cited page, and the question must be well-formed and new.

import { normalizeForMatch, words } from './text.mjs';
import { validateQuestion, nearDuplicateIndex } from './question.mjs';

export const MIN_QUOTE_WORDS = 5;

/** Checks a quote against the selection's segments. Returns { ok, reason?, spans? }. */
export function findQuote(segments, quote, page) {
  if (words(quote).length < MIN_QUOTE_WORDS) return { ok: false, reason: `the quote has fewer than ${MIN_QUOTE_WORDS} words` };
  const q = normalizeForMatch(quote).replace(/^["']|["']$/g, '');
  const i = segments.findIndex((s) => s.number === Number(page));
  if (i < 0) return { ok: false, reason: `page ${page} is outside the selection` };
  if (normalizeForMatch(segments[i].text).includes(q)) return { ok: true };
  if (i + 1 < segments.length && normalizeForMatch(`${segments[i].text}\n${segments[i + 1].text}`).includes(q)) {
    return { ok: true, spans: true };
  }
  return { ok: false, reason: 'the quote does not appear on the cited page' };
}

/**
 * Runs every deterministic check on a generated question.
 * Returns { ok: true } or { ok: false, reasons: [...] }; `poolStems` are the stems already held.
 */
export function checkGenerated(q, segments, poolStems = []) {
  const reasons = validateQuestion(q);
  const quote = findQuote(segments, q.source?.quote ?? '', q.source?.page);
  if (!quote.ok) reasons.push(quote.reason);
  if (nearDuplicateIndex(q.stem, poolStems) >= 0) reasons.push('nearly the same as a question already in the pool');
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
