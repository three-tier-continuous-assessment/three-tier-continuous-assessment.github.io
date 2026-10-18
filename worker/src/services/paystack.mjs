// Paystack (brief §6.2): initialize, verify, list, and webhook signatures (HMAC-SHA512 of the
// raw body under the secret key). The fake keeps transactions in memory and is completed from
// the site's test checkout page; it never takes money.

import { timingSafeEqual } from '../util.mjs';

async function hmacSha512Hex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function paystackClient({ secretKey, fetchImpl = (...a) => fetch(...a) }) {
  async function call(method, path, body) {
    const r = await fetchImpl(`https://api.paystack.co${path}`, {
      method,
      headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status === false) throw new Error(`Paystack ${path}: ${j.message ?? r.status}`);
    return j;
  }
  return {
    fake: false,
    async initialize({ email, amountKobo, reference, callbackUrl, metadata }) {
      const { data } = await call('POST', '/transaction/initialize', {
        email, amount: amountKobo, currency: 'NGN', reference, callback_url: callbackUrl, metadata,
      });
      return { authorizationUrl: data.authorization_url, reference: data.reference };
    },
    async verify(reference) {
      const { data } = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      return { status: data.status, amountKobo: data.amount, currency: data.currency, reference: data.reference };
    },
    async list({ from, to }) {
      const out = [];
      for (let page = 1; page <= 50; page++) {
        const q = new URLSearchParams({ perPage: '100', page: String(page), from: new Date(from).toISOString(), to: new Date(to).toISOString() });
        const j = await call('GET', `/transaction?${q}`);
        for (const t of j.data) out.push({ reference: t.reference, status: t.status, amountKobo: t.amount, currency: t.currency });
        if (!j.meta || page >= j.meta.pageCount) break;
      }
      return out;
    },
    async verifySignature(rawBody, signature) {
      return timingSafeEqual(await hmacSha512Hex(secretKey, rawBody), String(signature ?? '').toLowerCase());
    },
  };
}

export function fakePaystack({ siteOrigin, secretKey = 'sk_test_fake' }) {
  const txs = new Map();
  return {
    fake: true,
    async initialize({ email, amountKobo, reference, metadata }) {
      txs.set(reference, { status: 'abandoned', amountKobo, currency: 'NGN', email, metadata });
      return { authorizationUrl: `${siteOrigin}#/test-checkout/${encodeURIComponent(reference)}`, reference };
    },
    async verify(reference) {
      const t = txs.get(reference);
      if (!t) throw new Error('Paystack: transaction not found');
      return { status: t.status, amountKobo: t.amountKobo, currency: t.currency, reference };
    },
    async list() {
      return [...txs.entries()].map(([reference, t]) => ({ reference, status: t.status, amountKobo: t.amountKobo, currency: t.currency }));
    },
    /** Test checkout: mark a transaction paid (optionally with a different amount, for tests). */
    complete(reference, override = {}) {
      const t = txs.get(reference);
      if (!t) return false;
      Object.assign(t, { status: 'success' }, override);
      return true;
    },
    async verifySignature(rawBody, signature) {
      return timingSafeEqual(await hmacSha512Hex(secretKey, rawBody), String(signature ?? '').toLowerCase());
    },
    sign: (rawBody) => hmacSha512Hex(secretKey, rawBody),
  };
}
