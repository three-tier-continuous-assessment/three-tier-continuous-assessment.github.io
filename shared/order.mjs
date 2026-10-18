// Question order, unique by construction (brief §4.5).
//
// A sitting has N questions (canonical IDs sorted ascending), a secret key K and a
// seat capacity C. With P(N,k) = N!/(N-k)! and k* = min{k : P(N,k) >= C}:
//   1. relabel: shuffle the canonical list once with DRBG(K, "relabel")  -> a
//   2. scramble the seat: u = (alpha*s + beta) mod P(N,k*), gcd(alpha, P) = 1
//   3. write u in mixed radix (N, N-1, ..., N-k*+1)                     -> d_0..d_{k*-1}
//   4. Durstenfeld Fisher-Yates on a; step t (i = N-1-t) takes j = d_t for t < k*,
//      otherwise j uniform in [0, i] from DRBG(K, "seat:" + s).
// u is injective on [0, C), and Fisher-Yates maps choice sequences bijectively onto
// permutations, so distinct seats receive distinct orders.

import { drbg } from './drbg.mjs';

/** P(N, k) = N!/(N-k)! as a BigInt. */
export function fallingFactorial(n, k) {
  let p = 1n;
  for (let j = 0; j < k; j++) p *= BigInt(n - j);
  return p;
}

/** Smallest k with P(N,k) >= C, or null when N! < C (uniqueness impossible). */
export function prefixLength(n, capacity) {
  const c = BigInt(capacity);
  let p = 1n;
  for (let k = 1; k <= n; k++) {
    p *= BigInt(n - k + 1);
    if (p >= c) return k;
  }
  return null;
}

const gcd = (a, b) => {
  while (b) [a, b] = [b, a % b];
  return a;
};

/**
 * Prepares a sitting. Throws CapacityError when N! < C.
 * @param {string[]} questionIds  the sitting's question IDs, any order
 * @param {string|Uint8Array} key the sitting's secret key K
 * @param {number} capacity       seat capacity C
 */
export function prepareSitting(questionIds, key, capacity) {
  const ids = [...new Set(questionIds)].sort();
  if (ids.length !== questionIds.length) throw new Error('prepareSitting: duplicate question IDs');
  const n = ids.length;
  if (n < 1) throw new Error('prepareSitting: no questions');
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('prepareSitting: bad capacity');
  const k = prefixLength(n, capacity);
  if (k === null) {
    const err = new Error(`${n} questions allow at most ${n}! distinct orders, fewer than ${capacity} seats`);
    err.code = 'CAPACITY';
    throw err;
  }
  const m = fallingFactorial(n, k);
  const affine = drbg(key, 'affine');
  let alpha = m > 1n ? 1n + affine.bigint(m - 1n) : 1n;
  while (gcd(alpha, m) !== 1n) alpha = (alpha % m) + 1n;
  const beta = affine.bigint(m);

  const a = ids.slice();
  const relabel = drbg(key, 'relabel');
  for (let i = n - 1; i > 0; i--) {
    const j = relabel.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return { n, capacity, k, m, alpha, beta, base: a, key };
}

/** The question order (array of question IDs) for seat s of a prepared sitting. */
export function seatOrder(sitting, seat) {
  const { n, capacity, k, m, alpha, beta, base, key } = sitting;
  if (!Number.isInteger(seat) || seat < 0 || seat >= capacity) {
    throw new RangeError(`seat ${seat} outside [0, ${capacity})`);
  }
  let u = (alpha * BigInt(seat) + beta) % m;
  const digits = [];
  for (let t = 0; t < k; t++) {
    const r = BigInt(n - t);
    digits.push(Number(u % r));
    u /= r;
  }
  const a = base.slice();
  const rnd = drbg(key, `seat:${seat}`);
  for (let t = 0; t < n - 1; t++) {
    const i = n - 1 - t;
    const j = t < k ? digits[t] : rnd.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Display order of a question's options for one seat: a permutation of optionIds,
 * or the original order for true/false and fixed-option items.
 */
export function optionOrder(key, seat, questionId, optionIds, { fixed = false } = {}) {
  const a = optionIds.slice();
  if (fixed || a.length < 2) return a;
  const rnd = drbg(key, `options:${seat}:${questionId}`);
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const LETTERS = 'ABCDEFGHIJ';

/** Maps a displayed letter back to the canonical option ID for this seat. */
export function letterToOption(displayOrder, letter) {
  const i = LETTERS.indexOf(String(letter).toUpperCase());
  return i >= 0 && i < displayOrder.length ? displayOrder[i] : null;
}
