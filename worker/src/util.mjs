// Small helpers for the request handler: responses, errors, IDs, tokens.

import { hmacSha256, toHex, sha256Hex } from '../../shared/sha256.mjs';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export const randomId = (prefix = '') => prefix + toHex(randomBytes(12));

/** Crockford base32 code, e.g. a quiz code "7K3QX2" or a candidate code. */
export function randomCode(length) {
  let s = '';
  // Rejection-free: 32 divides 256, so each byte maps uniformly.
  for (const b of randomBytes(length)) s += CROCKFORD[b % 32];
  return s;
}

/** Normalizes a typed code: upper case, I/L -> 1, O -> 0, separators dropped. */
export function normalizeCode(s) {
  return String(s ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

export const hashCode = (s) => sha256Hex(`code:${normalizeCode(s)}`);

const b64url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
export { b64url, fromB64url };

/** Signed session token: base64url(JSON payload) . base64url(HMAC). */
export function signToken(key, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${b64url(hmacSha256(key, body))}`;
}

export function verifyToken(key, token, now) {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) return null;
  const expect = b64url(hmacSha256(key, body));
  if (!timingSafeEqual(expect, sig)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!payload.exp || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function readJSON(request, limitBytes = 2_000_000) {
  const text = await request.text();
  if (text.length > limitBytes) fail(413, 'request too large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    fail(400, 'body is not valid JSON');
  }
}

export const parseJSONColumn = (s, fallback = null) => {
  if (s === null || s === undefined) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
