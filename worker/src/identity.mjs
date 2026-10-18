// Sign-in and lecturer verification (brief §3.4, §5.6).

import { json, fail, randomId, randomCode, hashCode, signToken } from './util.mjs';
import { requireUser, requireLecturer, levelsOf, isAdmin, limit } from './app.mjs';
import { classifyLecturerEmail, hostedDomainMatches } from '../../shared/email-rules.mjs';
import { matchNames } from '../../shared/names.mjs';
import { hmacHex } from '../../shared/sha256.mjs';

const DAY = 86_400_000;
const SESSION_HOURS = 12;

/** Verifies a Google ID token and returns the stored user (created on first sign-in). */
export async function upsertGoogleUser(ctx, idToken) {
  let claims;
  try {
    claims = await ctx.services.google.verify(idToken);
  } catch (e) {
    fail(401, `Google sign-in failed: ${e.message}`);
  }
  if (!claims.emailVerified) fail(401, 'Google reports that this email address is not verified');
  // One atomic upsert, so simultaneous first sign-ins by the same account cannot collide.
  const user = await ctx.one(
    `INSERT INTO users (id, google_sub, email, name, hd, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, hd = excluded.hd
     RETURNING *`,
    randomId('u_'), claims.sub, claims.email, claims.name, claims.hd, ctx.now,
  );
  if (user.suspended) fail(403, 'this account is suspended');
  return { user, claims };
}

function level1Check(ctx, claims) {
  const r = classifyLecturerEmail(claims.email, ctx.config);
  if (!r.ok) return r;
  if (!hostedDomainMatches(claims.hd, r.domain)) {
    return { ok: false, reason: `sign in with your institution's Google account: Google does not confirm that ${claims.email} is managed by ${r.domain}` };
  }
  return r;
}

async function meData(ctx, user, l1Reason) {
  const { levels, tier } = await levelsOf(ctx, user.id);
  const view = (v) => v && { status: v.status, method: v.method, identifier: v.level === 3 ? null : v.identifier, checked_at: v.checked_at, expires_at: v.expires_at, id: v.id };
  return {
    user: { id: user.id, name: user.name, email: user.email },
    tier,
    admin: isAdmin(ctx, user),
    levels: { 1: view(levels[1]), 2: view(levels[2]), 3: view(levels[3]) },
    level1_reason: l1Reason ?? null,
  };
}

export async function signIn(ctx) {
  const { id_token } = await ctx.body();
  await limit(ctx, `signin:${ctx.ip}`, 600, 600);
  const { user, claims } = await upsertGoogleUser(ctx, id_token);
  const l1 = level1Check(ctx, claims);
  if (l1.ok) {
    const { levels } = await levelsOf(ctx, user.id);
    const current = levels[1];
    const valid = ctx.config.tiers.level1_valid_days * DAY;
    if (current?.status === 'passed' && current.identifier === claims.email) {
      await ctx.run('UPDATE verifications SET checked_at = ?, expires_at = ? WHERE id = ?', ctx.now, ctx.now + valid, current.id);
    } else if (current?.status !== 'revoked') {
      await ctx.run(
        "INSERT INTO verifications (id, user_id, level, method, identifier, status, checked_at, expires_at, created_at) VALUES (?, ?, 1, 'google-hd', ?, 'passed', ?, ?, ?)",
        randomId('v_'), user.id, claims.email, ctx.now, ctx.now + valid, ctx.now,
      );
      await ctx.audit(user.id, 'level1.passed', user.id, { domain: l1.institutionDomain });
    }
  }
  const token = signToken(ctx.secrets.SESSION_KEY, { k: 'u', uid: user.id, exp: ctx.now + SESSION_HOURS * 3_600_000 });
  return json({ token, ...(await meData(ctx, user, l1.ok ? null : l1.reason)) });
}

export async function me(ctx) {
  const user = await requireUser(ctx);
  return json(await meData(ctx, user));
}

// ---------------------------------------------------------------- Level 2

const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const SCOPUS = /^\d{5,15}$/;

function scholarId(s) {
  const m = /[?&]user=([\w-]{12})\b/.exec(String(s)) ?? /^([\w-]{12})$/.exec(String(s).trim());
  return m ? m[1] : null;
}

const INSTRUCTIONS = {
  orcid: (code) => `Sign in to orcid.org and add the keyword ${code} to your public record (Keywords section, visibility "Everyone"). Then press "I have added the code". You may remove it once you are verified.`,
  scholar: (code) => `Open your Google Scholar profile, choose Edit, and add ${code} to "Areas of interest". Then press "I have added the code". You may remove it once you are verified.`,
  scopus: (code) => `Scopus profiles cannot be edited by their authors. Make sure your ORCID record lists this Scopus Author ID (Scopus's ORCID wizard adds it), add the keyword ${code} to that ORCID record, then press "I have added the code".`,
};

export async function researchStart(ctx) {
  const { user } = await requireLecturer(ctx);
  const { method, identifier, orcid } = await ctx.body();
  let id;
  if (method === 'orcid') {
    if (!ORCID.test(String(identifier).trim())) fail(400, 'an ORCID iD looks like 0000-0002-1825-0097');
    id = String(identifier).trim();
  } else if (method === 'scholar') {
    id = scholarId(identifier);
    if (!id) fail(400, 'paste your Google Scholar profile address (it contains "user=")');
  } else if (method === 'scopus') {
    if (!SCOPUS.test(String(identifier).trim())) fail(400, 'a Scopus Author ID is a number of 5 to 15 digits');
    if (!ORCID.test(String(orcid ?? '').trim())) fail(400, 'give the ORCID iD whose record lists this Scopus Author ID');
    id = `scopus:${String(identifier).trim()}|orcid:${String(orcid).trim()}`;
  } else {
    fail(400, 'method must be orcid, scholar or scopus');
  }
  await limit(ctx, `research:${user.id}`, 10, 86_400);
  const code = `GCAES-${randomCode(5)}`;
  const v = { id: randomId('v_'), expires: ctx.now + ctx.config.tiers.level2_code_days * DAY };
  await ctx.run(
    "INSERT INTO verifications (id, user_id, level, method, identifier, status, code_hash, code_expires_at, created_at) VALUES (?, ?, 2, ?, ?, 'issued', ?, ?, ?)",
    v.id, user.id, method, id, hashCode(code), v.expires, ctx.now,
  );
  return json({ id: v.id, code, expires_at: v.expires, instructions: INSTRUCTIONS[method](code) });
}

export async function researchSubmit(ctx) {
  const { user } = await requireLecturer(ctx);
  const v = await ctx.one('SELECT * FROM verifications WHERE id = ? AND user_id = ? AND level = 2', ctx.params.id, user.id);
  if (!v) fail(404, 'no such verification');
  if (v.status !== 'issued') fail(409, `this verification is already ${v.status}`);
  if (v.code_expires_at < ctx.now) fail(410, 'the code has expired; start again for a new one');
  await ctx.run("UPDATE verifications SET status = 'review' WHERE id = ?", v.id);
  await ctx.audit(user.id, 'level2.submitted', v.id, { method: v.method });
  return json({ id: v.id, status: 'review' });
}

// ---------------------------------------------------------------- Level 3

export async function nin(ctx) {
  const { user } = await requireLecturer(ctx);
  const b = await ctx.body();
  if (b.consent !== true) fail(400, 'please read and accept the consent statement first');
  const ninValue = String(b.nin ?? '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(ninValue)) fail(400, 'a NIN has 11 digits');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dob ?? ''))) fail(400, 'give your date of birth as YYYY-MM-DD');
  await limit(ctx, `nin:${user.id}`, 3, 86_400);
  const ninHmac = hmacHex(ctx.secrets.NIN_PEPPER, ninValue);
  const taken = await ctx.one('SELECT user_id FROM verifications WHERE nin_hmac = ?', ninHmac);
  if (taken && taken.user_id !== user.id) fail(409, 'this NIN has already been used to certify another account');

  let r;
  try {
    r = await ctx.services.nin.lookup(ninValue);
  } catch (e) {
    fail(e.status ?? 502, e.status ? e.message : 'the NIN service did not answer; please try again later');
  }
  let status, reason = null;
  if (!r.found) {
    status = 'failed';
    reason = 'the NIN was not found';
  } else if (r.dob && r.dob !== b.dob) {
    status = 'failed';
    reason = 'the date of birth does not match the NIN record';
  } else {
    const onRecord = [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ');
    const m = matchNames(user.name, onRecord);
    status = m === 'pass' ? 'passed' : m === 'review' ? 'review' : 'failed';
    if (m === 'review') reason = 'the names match only partly; an administrator will review them';
    if (m === 'fail') reason = 'the names on the NIN record do not match your account';
  }
  const keepHmac = status === 'passed' || status === 'review';
  if (taken && keepHmac) {
    await ctx.run("UPDATE verifications SET status = ?, provider_ref = ?, checked_at = ?, note = ? WHERE nin_hmac = ?", status, r.reference, ctx.now, reason, ninHmac);
  } else {
    await ctx.run(
      'INSERT INTO verifications (id, user_id, level, method, status, provider_ref, nin_hmac, note, checked_at, created_at) VALUES (?, ?, 3, ?, ?, ?, ?, ?, ?, ?)',
      randomId('v_'), user.id, 'nin', status, r.reference, keepHmac ? ninHmac : null, reason, ctx.now, ctx.now,
    );
  }
  await ctx.audit(user.id, `level3.${status}`, user.id, null);
  return json({ status, reason });
}
