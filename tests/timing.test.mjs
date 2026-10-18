import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DURATIONS, allowedPaces, defaultCount, validateConfig, fittingConfigs,
  slotWindow, currentSlot, acceptsAnswer, attemptEnd,
} from '../shared/timing.mjs';

test('N = 60D/p for every allowed duration and pace, from 15 to 360', () => {
  const all = [];
  for (const tier of ['primary', 'secondary', 'tertiary']) {
    for (const d of DURATIONS) for (const p of allowedPaces(tier)) {
      const n = defaultCount(d, p);
      assert.ok(Number.isInteger(n), `${d} min at ${p} s`);
      assert.deepEqual(validateConfig({ tier, duration: d, pace: p, count: n }), []);
      all.push(n);
    }
  }
  assert.equal(Math.min(...all), 15);
  assert.equal(Math.max(...all), 360);
});

test('60 s per question is accepted for primary only', () => {
  assert.deepEqual(validateConfig({ tier: 'primary', duration: 15, pace: 60, count: 15 }), []);
  for (const tier of ['secondary', 'tertiary']) {
    const errs = validateConfig({ tier, duration: 15, pace: 60, count: 15 });
    assert.match(errs.join(' '), /primary-tier courses only/);
  }
});

test('counts beyond the duration, or beyond the approved pool, are rejected', () => {
  assert.match(validateConfig({ tier: 'tertiary', duration: 15, pace: 45, count: 21 }).join(), /between 1 and 20/);
  assert.match(validateConfig({ tier: 'tertiary', duration: 15, pace: 45, count: 20, available: 12 }).join(), /only 12 approved/);
  assert.deepEqual(validateConfig({ tier: 'tertiary', duration: 15, pace: 45, count: 12, available: 12 }), []);
  assert.match(validateConfig({ tier: 'tertiary', duration: 15, pace: 45, count: 12, grace: 11 }).join(), /grace/);
});

test('fittingConfigs offers only full-length configurations the pool can fill', () => {
  const fits = fittingConfigs('tertiary', 20);
  assert.deepEqual(fits, [{ duration: 15, pace: 45, count: 20 }]);
  assert.ok(fittingConfigs('primary', 15).some((c) => c.pace === 60));
});

test('slot windows, current slot, grace and finalization', () => {
  const t0 = 1_000_000, p = 30, n = 4, g = 3;
  assert.deepEqual(slotWindow(t0, p, 1), { open: t0, close: t0 + 30_000 });
  assert.equal(currentSlot(t0, p, n, t0 - 1), 0);
  assert.equal(currentSlot(t0, p, n, t0), 1);
  assert.equal(currentSlot(t0, p, n, t0 + 29_999), 1);
  assert.equal(currentSlot(t0, p, n, t0 + 30_000), 2);
  assert.equal(currentSlot(t0, p, n, t0 + 120_000), 5);
  assert.ok(acceptsAnswer(t0, p, n, g, 1, t0));
  assert.ok(acceptsAnswer(t0, p, n, g, 1, t0 + 33_000)); // inside grace
  assert.ok(!acceptsAnswer(t0, p, n, g, 1, t0 + 33_001)); // after grace
  assert.ok(!acceptsAnswer(t0, p, n, g, 2, t0 + 29_999)); // before the slot opens
  assert.ok(!acceptsAnswer(t0, p, n, g, 5, t0 + 130_000)); // no such slot
  assert.equal(attemptEnd(t0, p, n, g), t0 + 123_000);
});
