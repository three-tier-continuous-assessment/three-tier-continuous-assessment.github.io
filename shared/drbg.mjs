// Deterministic random bit generator: HMAC-SHA256(seed, counter) in 32-byte blocks.
// seed = HMAC-SHA256(key, label). Integers are drawn by rejection sampling, so a
// draw from [0, n) has no modulo bias.

import { hmacSha256, toBytes } from './sha256.mjs';

export function drbg(key, label) {
  const seed = hmacSha256(toBytes(key), toBytes(label));
  let counter = 0;
  let block = new Uint8Array(0);
  let view = new DataView(block.buffer);
  let offset = 0;

  function next32() {
    if (offset + 4 > block.length) {
      const c = new Uint8Array(4);
      new DataView(c.buffer).setUint32(0, counter++);
      block = hmacSha256(seed, c);
      view = new DataView(block.buffer);
      offset = 0;
    }
    const v = view.getUint32(offset);
    offset += 4;
    return v;
  }

  return {
    /** Uniform integer in [0, n), 1 <= n <= 2^32. */
    int(n) {
      if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`drbg.int: bad n ${n}`);
      if (n === 1) return 0;
      const limit = Math.floor(2 ** 32 / n) * n;
      let v;
      do v = next32(); while (v >= limit);
      return v % n;
    },
    /** Uniform BigInt in [0, n) for n >= 1n, by rejection on the smallest covering bit width. */
    bigint(n) {
      if (typeof n !== 'bigint' || n < 1n) throw new RangeError('drbg.bigint: bad n');
      if (n === 1n) return 0n;
      const bits = n.toString(2).length;
      const words = Math.ceil(bits / 32);
      const excess = BigInt(words * 32 - bits);
      for (;;) {
        let v = 0n;
        for (let i = 0; i < words; i++) v = (v << 32n) | BigInt(next32());
        v >>= excess;
        if (v < n) return v;
      }
    },
  };
}
