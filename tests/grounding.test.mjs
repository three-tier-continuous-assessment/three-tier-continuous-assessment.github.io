import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findQuote, checkGenerated } from '../shared/grounding.mjs';
import { nearDuplicateIndex } from '../shared/question.mjs';

// FIXTURE: synthetic selected text.
const segments = [
  { number: 12, text: 'An offer is an expression of willing-\nness to contract on specified terms, made with the intention that it binds the offeror once accepted.' },
  { number: 13, text: '“Acceptance” must be unqualified and must be communicated to the offeror.' },
];

test('a verbatim quote is found on its page despite line-break hyphens, quotes and case', () => {
  assert.deepEqual(findQuote(segments, 'expression of willingness to contract on specified terms', 12), { ok: true });
  assert.ok(findQuote(segments, '"acceptance" must be unqualified and must be communicated', 13).ok);
  assert.ok(findQuote(segments, 'binds the offeror once accepted. "Acceptance" must be unqualified', 12).spans);
});

test('fabricated, misplaced or too-short quotes are rejected', () => {
  assert.match(findQuote(segments, 'an offer may be revoked at any time before acceptance', 12).reason, /does not appear/);
  assert.match(findQuote(segments, 'expression of willingness to contract on specified terms', 13).reason, /does not appear/);
  assert.match(findQuote(segments, 'expression of willingness to contract', 40).reason, /outside the selection/);
  assert.match(findQuote(segments, 'an offer', 12).reason, /fewer than 5 words/);
});

test('checkGenerated combines shape, grounding and duplicate checks', () => {
  const good = {
    type: 'mcq', stem: 'Which describes an offer?',
    options: [{ id: 'a', text: 'An expression of willingness to contract' }, { id: 'b', text: 'An invitation to treat' }],
    key: 'a', source: { page: 12, quote: 'expression of willingness to contract on specified terms' },
  };
  assert.deepEqual(checkGenerated(good, segments), { ok: true });
  const bad = { ...good, key: 'z', source: { page: 12, quote: 'a sentence that is not in the notes at all' } };
  const r = checkGenerated(bad, segments, ['Which describes an offer?']);
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 3);
});

test('near-duplicate detection', () => {
  const pool = ['Which of the following best describes an offer in contract law?', 'What is consideration?'];
  assert.equal(nearDuplicateIndex('Which of the following best describes an offer in contract law', pool), 0);
  assert.equal(nearDuplicateIndex('When must acceptance be communicated?', pool), -1);
});
