// The request handler (brief §3.8): web-standard APIs only, so it runs unchanged on Cloudflare
// Workers (D1), in Node (node:sqlite) and in the browser demo (sql.js).
//
// createApp({ db, config, services, secrets }) -> async handle(request, { ip }) -> Response
//   db        D1-compatible: prepare(sql).bind(...).first()/all()/run(), batch([...])
//   config    { pricing, tiers, isListedDomain(d), extraDomains, blockedDomains, studentPatterns }
//   services  { google, paystack, ai, nin, clock? }
//   secrets   { SESSION_KEY, NIN_PEPPER, SITE_ORIGIN, ADMIN_EMAILS }

import { json, HttpError, fail, verifyToken, readJSON } from './util.mjs';
import * as identity from './identity.mjs';
import * as material from './material.mjs';
import * as quizzes from './quizzes.mjs';
import * as sitting from './sitting.mjs';
import * as money from './money.mjs';
import * as admin from './admin.mjs';

const ROUTES = [
  ['POST', '/api/auth/google', identity.signIn],
  ['GET', '/api/me', identity.me],
  ['POST', '/api/verify/research', identity.researchStart],
  ['POST', '/api/verify/research/:id/submit', identity.researchSubmit],
  ['POST', '/api/verify/nin', identity.nin],

  ['GET', '/api/courses', material.listCourses],
  ['POST', '/api/courses', material.createCourse],
  ['PUT', '/api/courses/:id', material.updateCourse],
  ['GET', '/api/courses/:id/notes', material.listNotes],
  ['POST', '/api/courses/:id/notes', material.addNote],
  ['PUT', '/api/notes/:id', material.updateNote],
  ['DELETE', '/api/notes/:id', material.deleteNote],
  ['PUT', '/api/notes/:id/pages/:idx', material.updatePage],
  ['POST', '/api/transcribe', material.transcribe],
  ['POST', '/api/courses/:id/preview', material.preview],
  ['POST', '/api/courses/:id/schedule', material.schedule],
  ['POST', '/api/courses/:id/generate', material.generate],
  ['POST', '/api/courses/:id/pool', material.importPool],
  ['POST', '/api/courses/:id/assist', material.assist],
  ['GET', '/api/courses/:id/questions', material.listQuestions],
  ['PUT', '/api/questions/:id', material.updateQuestion],
  ['POST', '/api/courses/:id/questions/bulk', material.bulk],

  ['GET', '/api/quizzes', quizzes.list],
  ['POST', '/api/quizzes', quizzes.create],
  ['GET', '/api/quizzes/:id', quizzes.get],
  ['PUT', '/api/quizzes/:id', quizzes.update],
  ['POST', '/api/quizzes/:id/roster', quizzes.roster],
  ['POST', '/api/quizzes/:id/publish', quizzes.publish],
  ['GET', '/api/quizzes/:id/status', quizzes.status],
  ['POST', '/api/attempts/:id/void', quizzes.voidAttempt],
  ['POST', '/api/attempts/:id/reset', quizzes.resetAttempt],

  ['GET', '/api/q/:code', sitting.card],
  ['POST', '/api/q/:code/checkin', sitting.checkin],
  ['POST', '/api/attempt/start', sitting.start],
  ['GET', '/api/attempt/slot', sitting.slot],
  ['POST', '/api/attempt/answer', sitting.answer],

  ['GET', '/api/attempt/result', money.studentResult],
  ['GET', '/api/quizzes/:id/report', money.classReport],
  ['GET', '/api/pricing', money.pricing],
  ['POST', '/api/pay/init', money.init],
  ['POST', '/api/pay/verify', money.verify],
  ['POST', '/api/pay/webhook', money.webhook],
  ['POST', '/api/pay/test-complete', money.testComplete],
  ['GET', '/api/results/:id', money.verifyResult],

  ['GET', '/api/admin/verifications', admin.verifications],
  ['POST', '/api/admin/verifications/:id', admin.decide],
  ['POST', '/api/admin/revoke', admin.revoke],
  ['POST', '/api/admin/suspend', admin.suspend],
  ['GET', '/api/admin/reconcile', admin.reconcile],
].map(([method, path, handler]) => ({
  method,
  re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  handler,
}));

function corsHeaders(siteOrigin, requestOrigin) {
  const allow = !siteOrigin || siteOrigin === '*' ? '*' : siteOrigin.replace(/\/$/, '') === requestOrigin ? requestOrigin : siteOrigin.replace(/\/$/, '');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function withHeaders(res, headers) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function createApp(deps) {
  const { db } = deps;
  const prep = (sql, params) => {
    const s = db.prepare(sql);
    return params.length ? s.bind(...params.map(clean)) : s;
  };
  const dbApi = {
    one: (sql, ...p) => prep(sql, p).first(),
    all: async (sql, ...p) => (await prep(sql, p).all()).results ?? [],
    run: (sql, ...p) => prep(sql, p).run(),
    batch: (stmts) => db.batch(stmts.map(([sql, ...p]) => prep(sql, p))),
  };

  return async function handle(request, extra = {}) {
    const url = new URL(request.url);
    const cors = corsHeaders(deps.secrets.SITE_ORIGIN, request.headers.get('origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      for (const route of ROUTES) {
        if (route.method !== request.method) continue;
        const m = route.re.exec(url.pathname);
        if (!m) continue;
        const now = deps.services.clock ? deps.services.clock() : Date.now();
        let session;
        const ctx = {
          ...deps,
          ...dbApi,
          request,
          url,
          params: m.groups ?? {},
          now,
          ip: extra.ip ?? request.headers.get('cf-connecting-ip') ?? 'local',
          body: () => readJSON(request),
          session() {
            if (session !== undefined) return session;
            const h = request.headers.get('authorization') ?? '';
            session = h.startsWith('Bearer ') ? verifyToken(deps.secrets.SESSION_KEY, h.slice(7), now) : null;
            return session;
          },
          audit: (actor, action, target, detail) =>
            dbApi.run('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)', now, actor, action, target, detail ? JSON.stringify(detail) : null),
        };
        return withHeaders(await route.handler(ctx), cors);
      }
      return withHeaders(json({ error: 'not found' }, 404), cors);
    } catch (e) {
      if (e instanceof HttpError) return withHeaders(json({ error: e.message, ...e.extra }, e.status), cors);
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600) return withHeaders(json({ error: e.message }, e.status), cors);
      console.error('unhandled', e?.stack ?? e);
      return withHeaders(json({ error: 'something went wrong on the server' }, 500), cors);
    }
  };
}

// ---------------------------------------------------------------- shared guards

export async function requireUser(ctx) {
  const s = ctx.session();
  if (!s || s.k !== 'u') fail(401, 'please sign in');
  const user = await ctx.one('SELECT * FROM users WHERE id = ?', s.uid);
  if (!user) fail(401, 'please sign in again');
  if (user.suspended) fail(403, 'this account is suspended');
  return user;
}

export function isAdmin(ctx, user) {
  const list = String(ctx.secrets.ADMIN_EMAILS ?? '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  return !!user?.email && list.includes(user.email.toLowerCase());
}

/** Current verification state: { 1, 2, 3 } each { status, ... } | null, plus tier. */
export async function levelsOf(ctx, userId) {
  const rows = await ctx.all('SELECT * FROM verifications WHERE user_id = ? ORDER BY created_at DESC', userId);
  const out = { 1: null, 2: null, 3: null };
  for (const r of rows) {
    const live = r.status === 'passed' && (!r.expires_at || r.expires_at > ctx.now);
    if (live) { if (out[r.level]?.status !== 'passed') out[r.level] = r; }
    else if (!out[r.level]) out[r.level] = r;
  }
  const passed = (l) => out[l]?.status === 'passed' && (!out[l].expires_at || out[l].expires_at > ctx.now);
  const tier = passed(1) ? (passed(2) || passed(3) ? 'gold' : 'verified') : 'none';
  return { levels: out, tier, passed };
}

export async function requireLecturer(ctx) {
  const user = await requireUser(ctx);
  const lv = await levelsOf(ctx, user.id);
  if (lv.tier === 'none' && !isAdmin(ctx, user)) {
    fail(403, 'lecturer access needs Level 1 verification: sign in with your institution\'s Google account', { needs: 'level1' });
  }
  return { user, tier: isAdmin(ctx, user) && lv.tier === 'none' ? 'verified' : lv.tier, levels: lv };
}

export function goldOnly(ctx, tier, feature) {
  if ((ctx.config.tiers.gold_only ?? []).includes(feature) && tier !== 'gold') {
    fail(403, 'this feature needs Gold Certified status (Level 1 plus Level 2 or Level 3)', { needs: 'gold', feature });
  }
}

export async function limit(ctx, key, max, windowSec) {
  const w = Math.floor(ctx.now / (windowSec * 1000));
  const row = await ctx.one(
    'INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count',
    key, w,
  );
  if (row.count > max) fail(429, 'too many attempts; please wait a few minutes and try again');
}
