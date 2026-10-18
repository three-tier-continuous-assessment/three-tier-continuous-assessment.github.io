// Google Sign-In: verifies an ID token (RS256) against Google's published keys (brief §3.4).
// The fake verifier accepts "fake.<base64url(JSON claims)>" tokens for development, tests and
// the browser demo; it must never be configured in production.

import { fromB64url } from '../util.mjs';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const decode = (part) => JSON.parse(new TextDecoder().decode(fromB64url(part)));

function claimsOut(c) {
  return {
    sub: String(c.sub),
    email: c.email ? String(c.email).toLowerCase() : null,
    emailVerified: c.email_verified === true || c.email_verified === 'true',
    name: c.name ? String(c.name) : null,
    hd: c.hd ? String(c.hd).toLowerCase() : null,
  };
}

export function googleVerifier({ clientId, now = () => Date.now(), fetchImpl = (...a) => fetch(...a) }) {
  let cache = null;
  async function keys(force = false) {
    if (force || !cache || now() - cache.at > 3_600_000) {
      const r = await fetchImpl('https://www.googleapis.com/oauth2/v3/certs');
      if (!r.ok) throw new Error('could not fetch Google signing keys');
      cache = { at: now(), keys: (await r.json()).keys };
    }
    return cache.keys;
  }
  return {
    fake: false,
    async verify(idToken) {
      const parts = String(idToken ?? '').split('.');
      if (parts.length !== 3) throw new Error('malformed ID token');
      const [h, p, s] = parts;
      const header = decode(h), claims = decode(p);
      if (header.alg !== 'RS256') throw new Error('unexpected token algorithm');
      let jwk = (await keys()).find((k) => k.kid === header.kid);
      if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid);
      if (!jwk) throw new Error('unknown signing key');
      const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
      if (!ok) throw new Error('bad token signature');
      if (!ISSUERS.includes(claims.iss)) throw new Error('wrong token issuer');
      if (claims.aud !== clientId) throw new Error('token is for another application');
      if (!claims.exp || claims.exp * 1000 < now()) throw new Error('token expired');
      return claimsOut(claims);
    },
  };
}

export function fakeGoogleVerifier() {
  return {
    fake: true,
    async verify(idToken) {
      const t = String(idToken ?? '');
      if (!t.startsWith('fake.')) throw new Error('not a fake token');
      return claimsOut(decode(t.slice(5)));
    },
  };
}

/** Builds a fake token (development, tests, demo). */
export function fakeGoogleToken(claims) {
  const bytes = new TextEncoder().encode(JSON.stringify({ email_verified: true, ...claims }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'fake.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
