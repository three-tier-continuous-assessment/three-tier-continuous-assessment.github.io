import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeAnswer, gradeAttempt, scaled, grade, BAND_PRESETS, itemAnalysis, normalizeShort, parseNumber,
} from '../shared/grade.mjs';

const mcq = { id: 'm', type: 'mcq', key: 'b' };
const tf = { id: 't', type: 'tf', key: 'false' };
const num = { id: 'n', type: 'numeric', key: 9.81, tolerance: { abs: 0.05 } };
const rel = { id: 'r', type: 'numeric', key: 200, tolerance: { rel: 0.01 } };
const short = { id: 's', type: 'short', key: 'Consideration', accepted: ['valuable consideration'] };

test('each question type marks correctly', () => {
  assert.equal(gradeAnswer(mcq, 'b').correct, true);
  assert.equal(gradeAnswer(mcq, 'a').correct, false);
  assert.equal(gradeAnswer(tf, 'FALSE').correct, true);
  assert.equal(gradeAnswer(num, '9.8').correct, true);
  assert.equal(gradeAnswer(num, '9,85').correct, true); // decimal comma
  assert.equal(gradeAnswer(num, '9.87').correct, false);
  assert.equal(gradeAnswer(rel, 202).correct, true);
  assert.equal(gradeAnswer(rel, 202.5).correct, false);
  assert.equal(gradeAnswer(short, '  consideration. ').correct, true);
  assert.equal(gradeAnswer(short, 'Valuable  Consideration').correct, true);
  assert.equal(gradeAnswer(short, 'offer').correct, false);
});

test('unanswered questions score zero and are counted separately', () => {
  const r = gradeAttempt([mcq, tf, num, short, { ...rel, marks: 2 }], { m: 'b', t: 'true', s: 'consideration' });
  assert.deepEqual(
    { attempted: r.attempted, correct: r.correct, wrong: r.wrong, unanswered: r.unanswered, score: r.score, max: r.max },
    { attempted: 3, correct: 2, wrong: 1, unanswered: 2, score: 2, max: 6 },
  );
  assert.equal(r.percent, 33.33);
  assert.equal(gradeAnswer(mcq, null).answered, false);
  assert.equal(gradeAnswer(mcq, '').answered, false);
});

test('scaled values and band presets', () => {
  assert.equal(scaled(15, 20, 10), 7.5);
  assert.equal(scaled(15, 20, 0), null);
  assert.equal(grade(70, BAND_PRESETS['ng-university']), 'A');
  assert.equal(grade(69.99, BAND_PRESETS['ng-university']), 'B');
  assert.equal(grade(39.99, BAND_PRESETS['ng-university']), 'F');
  assert.equal(grade(75, BAND_PRESETS.waec), 'A1');
  assert.equal(grade(74.99, BAND_PRESETS.waec), 'B2');
  assert.equal(grade(44, BAND_PRESETS.waec), 'E8');
  assert.equal(grade(12, BAND_PRESETS.none), null);
});

test('item analysis flags a question that stronger candidates miss', () => {
  // Ten candidates: q-good is answered by the strongest five, q-bad only by the weakest five.
  const matrix = Array.from({ length: 10 }, (_, i) => ({
    total: 10 - i,
    correct: new Set(i < 5 ? ['q-good'] : ['q-bad']),
  }));
  const a = itemAnalysis(['q-good', 'q-bad'], matrix);
  assert.equal(a['q-good'].suspect, false);
  assert.ok(a['q-good'].d > 0);
  assert.equal(a['q-bad'].suspect, true);
  assert.ok(a['q-bad'].d < 0);
});

test('normalization helpers', () => {
  assert.equal(normalizeShort('  “Offer”, ACCEPTED! '), 'offer", accepted');
  assert.ok(Number.isNaN(parseNumber('12abc')));
  assert.equal(parseNumber(' 1e3 '), 1000);
});
