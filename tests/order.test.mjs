import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { prepareSitting, seatOrder, optionOrder, letterToOption, LETTERS, prefixLength } from '../shared/order.mjs';

const SLOW = !!process.env.SLOW;
const ids = (n) => Array.from({ length: n }, (_, i) => `q${String(i).padStart(3, '0')}`);
const key = () => new Uint8Array(randomBytes(32));

test('every seat receives a distinct order (exhaustive)', () => {
  const capacity = SLOW ? 100_000 : 10_000;
  for (const n of [15, 20, 60, 90]) {
    const sitting = prepareSitting(ids(n), key(), capacity);
    const seen = new Set();
    for (let s = 0; s < capacity; s++) {
      const o = seatOrder(sitting, s);
      assert.equal(o.length, n);
      seen.add(o.join(','));
    }
    assert.equal(seen.size, capacity, `N=${n}, k*=${sitting.k}`);
  }
});

test('N = 5 with C = 120 gives every one of the 5! orders; C = 121 is refused', () => {
  const sitting = prepareSitting(ids(5), key(), 120);
  const seen = new Set();
  for (let s = 0; s < 120; s++) seen.add(seatOrder(sitting, s).join(','));
  assert.equal(seen.size, 120);
  assert.throws(() => prepareSitting(ids(5), key(), 121), (e) => e.code === 'CAPACITY');
  assert.equal(prefixLength(5, 121), null);
});

test('orders are deterministic for a key and differ between keys', () => {
  const k1 = key();
  const a = prepareSitting(ids(30), k1, 500);
  const b = prepareSitting([...ids(30)].reverse(), k1, 500); // input order must not matter
  for (const s of [0, 1, 250, 499]) assert.deepEqual(seatOrder(a, s), seatOrder(b, s));
  const c = prepareSitting(ids(30), key(), 500);
  assert.notDeepEqual(seatOrder(a, 0), seatOrder(c, 0));
  assert.throws(() => seatOrder(a, 500), RangeError);
});

test('the DRBG shuffle is unbiased (chi-square, N = 5, 100,000 shuffles)', () => {
  const k = key();
  const n = 5;
  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  const draws = 100_000;
  for (let s = 0; s < draws; s++) {
    const o = optionOrder(k, s, 'q', [0, 1, 2, 3, 4]);
    o.forEach((el, pos) => counts[pos][el]++);
  }
  const expected = draws / n;
  let chi2 = 0;
  for (const row of counts) for (const c of row) chi2 += (c - expected) ** 2 / expected;
  // 16 degrees of freedom; the 0.999 quantile is 39.25.
  assert.ok(chi2 < 39.25, `chi-square ${chi2.toFixed(2)}`);
});

test('orders are far apart: mean pairwise Hamming distance >= N - 2 over 2,000 seats', () => {
  for (const n of [15, 60]) {
    const sitting = prepareSitting(ids(n), key(), 2000);
    const orders = Array.from({ length: 2000 }, (_, s) => seatOrder(sitting, s));
    let sum = 0, min = Infinity, pairs = 0;
    for (let x = 0; x < orders.length; x++) {
      for (let y = x + 1; y < orders.length; y++) {
        let h = 0;
        for (let i = 0; i < n; i++) if (orders[x][i] !== orders[y][i]) h++;
        sum += h; pairs++;
        if (h < min) min = h;
      }
    }
    const mean = sum / pairs;
    console.log(`  N=${n}: mean Hamming ${mean.toFixed(3)}, minimum ${min}`);
    assert.ok(mean >= n - 2, `mean ${mean}`);
  }
});

test('the displayed correct letter always maps back to the stored key', () => {
  const k = key();
  const options = ['opt-a', 'opt-b', 'opt-c', 'opt-d'];
  for (let s = 0; s < 500; s++) {
    for (const qid of ['q1', 'q2', 'q3']) {
      const display = optionOrder(k, s, qid, options);
      assert.deepEqual([...display].sort(), [...options].sort());
      const letter = LETTERS[display.indexOf('opt-c')];
      assert.equal(letterToOption(display, letter), 'opt-c');
    }
  }
  assert.deepEqual(optionOrder(k, 3, 'tf', ['true', 'false'], { fixed: true }), ['true', 'false']);
  assert.equal(letterToOption(['x', 'y'], 'Z'), null);
});
