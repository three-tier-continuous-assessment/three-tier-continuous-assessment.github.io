import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { sha256Hex, hmacHex, fromHex, toHex } from '../shared/sha256.mjs';

test('sha256 matches the FIPS 180-4 vector for "abc"', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256 matches node:crypto for every length 0..300 and random inputs', () => {
  for (let len = 0; len <= 300; len++) {
    const b = randomBytes(len);
    assert.equal(sha256Hex(new Uint8Array(b)), createHash('sha256').update(b).digest('hex'), `length ${len}`);
  }
  const text = 'Ọ̀rọ̀ — Unicode text, ńdị́ ụ́mụ́akwụkwọ ✓';
  assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'));
});

test('hmac-sha256 matches node:crypto, including keys longer than one block', () => {
  for (const klen of [0, 1, 32, 63, 64, 65, 200]) {
    for (const mlen of [0, 1, 55, 56, 64, 300]) {
      const k = randomBytes(klen), m = randomBytes(mlen);
      assert.equal(hmacHex(new Uint8Array(k), new Uint8Array(m)), createHmac('sha256', k).update(m).digest('hex'));
    }
  }
});

test('hex round-trip', () => {
  const b = new Uint8Array(randomBytes(40));
  assert.deepEqual(fromHex(toHex(b)), b);
  assert.throws(() => fromHex('xyz'));
});
