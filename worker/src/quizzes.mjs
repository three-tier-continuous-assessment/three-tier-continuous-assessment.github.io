// Quizzes (brief §4, §5.1, §7.4): drafts, rosters, publication, live status, void and reset.

import { json, fail, randomId, randomCode, hashCode, randomBytes, parseJSONColumn } from './util.mjs';
import { requireLecturer, goldOnly } from './app.mjs';
import { courseFor } from './material.mjs';
import { validateConfig, defaultCount, GRACE_DEFAULT } from '../../shared/timing.mjs';
import { prepareSitting } from '../../shared/order.mjs';
import { BAND_PRESETS } from '../../shared/grade.mjs';
import { parseCSV } from '../../shared/text.mjs';
import { toHex } from '../../shared/sha256.mjs';
import { drbg } from '../../shared/drbg.mjs';

export const OPEN_CAPACITY = 1_000_000_000;

export async function quizFor(ctx, quizId) {
  const z = await ctx.one('SELECT * FROM quizzes WHERE id = ?', quizId);
  if (!z) fail(404, 'no such quiz');
  const access = await courseFor(ctx, z.course_id);
  return { ...access, quiz: z };
}

function quizView(z, extra = {}) {
  const { secret, ...rest } = z;
  return { ...rest, selection: parseJSONColumn(z.selection), question_ids: parseJSONColumn(z.question_ids, []), ...extra };
}

export async function list(ctx) {
  const { user } = await requireLecturer(ctx);
  const course = ctx.url.searchParams.get('course_id');
  const rows = course
    ? (await courseFor(ctx, course), await ctx.all('SELECT * FROM quizzes WHERE course_id = ? ORDER BY created_at', course))
    : await ctx.all('SELECT * FROM quizzes WHERE owner_id = ? ORDER BY created_at DESC', user.id);
  return json({ quizzes: rows.map((z) => quizView(z)) });
}

function readConfig(b, current = {}) {
  const pick = (k, d) => (b[k] !== undefined ? b[k] : current[k] ?? d);
  const duration = Number(pick('duration', 15)), pace = Number(pick('pace', 30));
  return {
    title: String(pick('title', '')).trim().slice(0, 200),
    label: pick('label', null),
    selection: b.selection !== undefined ? b.selection : parseJSONColumn(current.selection),
    question_ids: b.question_ids !== undefined ? b.question_ids : parseJSONColumn(current.question_ids, []),
    duration, pace,
    count: Number(pick('count', defaultCount(duration, pace))),
    grace: Number(pick('grace', GRACE_DEFAULT)),
    opens_at: pick('opens_at', null),
    last_start: pick('last_start', null),
    open_sitting: pick('open_sitting', 0) ? 1 : 0,
    scale_to: pick('scale_to', null),
    bands: pick('bands', 'none'),
    pass_mark: Number(pick('pass_mark', 40)),
  };
}

function checkShape(c) {
  if (!c.title) fail(400, 'a quiz needs a title');
  if (!(c.bands in BAND_PRESETS)) fail(400, `bands must be one of ${Object.keys(BAND_PRESETS).join(', ')}`);
  if (!Array.isArray(c.question_ids)) fail(400, 'question_ids must be a list');
  if (c.opens_at !== null && !Number.isInteger(c.opens_at)) fail(400, 'opens_at must be a time in milliseconds');
  if (c.last_start !== null && (!Number.isInteger(c.last_start) || (c.opens_at !== null && c.last_start < c.opens_at))) fail(400, 'last_start must come after opens_at');
  if (c.scale_to !== null && !(Number(c.scale_to) > 0)) fail(400, 'scale_to must be a positive number');
}

export async function create(ctx) {
  const b = await ctx.body();
  const { course, user, tier } = await courseFor(ctx, b.course_id);
  const c = readConfig(b);
  checkShape(c);
  if (c.open_sitting) goldOnly(ctx, tier, 'open_sitting');
  const errs = validateConfig({ tier: course.tier, duration: c.duration, pace: c.pace, count: c.count, grace: c.grace });
  if (errs.length) fail(400, errs.join('; '));
  const id = randomId('z_');
  await ctx.run(
    `INSERT INTO quizzes (id, course_id, owner_id, title, label, selection, question_ids, duration, pace, count, grace, opens_at, last_start,
       open_sitting, scale_to, bands, pass_mark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, course.id, user.id, c.title, c.label, c.selection ? JSON.stringify(c.selection) : null, JSON.stringify(c.question_ids),
    c.duration, c.pace, c.count, c.grace, c.opens_at, c.last_start, c.open_sitting, c.scale_to, c.bands, c.pass_mark, ctx.now,
  );
  return json({ id }, 201);
}

export async function get(ctx) {
  const { quiz } = await quizFor(ctx, ctx.params.id);
  const roster = await ctx.all('SELECT seat, reg_no, full_name, email, listed, confirmed FROM roster WHERE quiz_id = ? ORDER BY seat', quiz.id);
  return json(quizView(quiz, { roster, link_code: quiz.code }));
}

export async function update(ctx) {
  const { quiz, course, tier } = await quizFor(ctx, ctx.params.id);
  const b = await ctx.body();
  if (quiz.status !== 'draft') {
    // After publication only the window and the grace can move, and the quiz can be closed.
    const opens = b.opens_at !== undefined ? b.opens_at : quiz.opens_at;
    const last = b.last_start !== undefined ? b.last_start : quiz.last_start;
    const status = b.status === 'closed' ? 'closed' : quiz.status;
    await ctx.run('UPDATE quizzes SET opens_at = ?, last_start = ?, status = ? WHERE id = ?', opens, last, status, quiz.id);
    return json({ ok: true });
  }
  const c = readConfig(b, quiz);
  checkShape(c);
  if (c.open_sitting) goldOnly(ctx, tier, 'open_sitting');
  const errs = validateConfig({ tier: course.tier, duration: c.duration, pace: c.pace, count: c.count, grace: c.grace });
  if (errs.length) fail(400, errs.join('; '));
  await ctx.run(
    `UPDATE quizzes SET title = ?, label = ?, selection = ?, question_ids = ?, duration = ?, pace = ?, count = ?, grace = ?, opens_at = ?,
       last_start = ?, open_sitting = ?, scale_to = ?, bands = ?, pass_mark = ? WHERE id = ?`,
    c.title, c.label, c.selection ? JSON.stringify(c.selection) : null, JSON.stringify(c.question_ids), c.duration, c.pace, c.count, c.grace,
    c.opens_at, c.last_start, c.open_sitting, c.scale_to, c.bands, c.pass_mark, quiz.id,
  );
  return json({ ok: true });
}

// ---------------------------------------------------------------- roster

const HEADERS = {
  reg_no: ['reg no', 'reg_no', 'regno', 'registration number', 'reg. no', 'reg. no.', 'matric no', 'student id', 'id'],
  full_name: ['name', 'full name', 'full_name', 'student name', 'names'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'phone number', 'mobile', 'gsm'],
};

export async function roster(ctx) {
  const { quiz, user } = await quizFor(ctx, ctx.params.id);
  if (quiz.status !== 'draft') fail(409, 'the roster is fixed once the quiz is published');
  const { csv, codes = false } = await ctx.body();
  const rows = parseCSV(String(csv ?? ''));
  if (rows.length < 2) fail(400, 'paste or upload a roster with a header row (e.g. "Reg No,Name,Email")');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  if (col.reg_no < 0) fail(400, 'the roster needs a registration-number column');
  const seen = new Set();
  const entries = [];
  for (const r of rows.slice(1)) {
    const reg = String(r[col.reg_no] ?? '').trim();
    if (!reg) continue;
    const k = reg.toLowerCase();
    if (seen.has(k)) fail(400, `registration number ${reg} appears twice`);
    seen.add(k);
    entries.push({
      reg_no: reg,
      full_name: col.full_name >= 0 ? String(r[col.full_name] ?? '').trim() || null : null,
      email: col.email >= 0 ? String(r[col.email] ?? '').trim().toLowerCase() || null : null,
      phone: col.phone >= 0 ? String(r[col.phone] ?? '').trim() || null : null,
    });
  }
  if (!entries.length) fail(400, 'the roster has no rows');
  if (entries.length > 20_000) fail(413, 'a roster may have at most 20,000 rows');
  const issued = entries.map((e) => ({ ...e, code: codes ? randomCode(8) : null }));
  await ctx.batch([
    ['DELETE FROM roster WHERE quiz_id = ?', quiz.id],
    ...issued.map((e, seat) => ['INSERT INTO roster (quiz_id, seat, reg_no, full_name, email, phone, code_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      quiz.id, seat, e.reg_no, e.full_name, e.email, e.phone, e.code ? hashCode(e.code) : null]),
    ['UPDATE quizzes SET roster_size = ? WHERE id = ?', issued.length, quiz.id],
  ]);
  await ctx.audit(user.id, 'roster.set', quiz.id, { rows: issued.length, codes: !!codes });
  return json({
    rows: issued.length,
    codes: codes ? issued.map((e, seat) => ({ seat, reg_no: e.reg_no, name: e.full_name, code: e.code })) : null,
    note: codes ? 'These codes are shown only now. Print or save them before leaving this page.' : null,
  });
}

// ---------------------------------------------------------------- publication

async function chooseQuestions(ctx, quiz, secret) {
  const ids = parseJSONColumn(quiz.question_ids, []);
  const approved = await ctx.all("SELECT * FROM questions WHERE course_id = ? AND status = 'approved'", quiz.course_id);
  let pool;
  if (ids.length) {
    const set = new Set(ids);
    pool = approved.filter((q) => set.has(q.id));
    if (pool.length < ids.length) fail(409, 'some chosen questions are no longer approved');
  } else {
    pool = approved.filter((q) => parseJSONColumn(q.source, {}).quiz === quiz.id);
    const sel = parseJSONColumn(quiz.selection);
    if (!pool.length && sel?.kind === 'pages') {
      pool = approved.filter((q) => {
        const page = parseJSONColumn(q.source, {}).page;
        return Number.isInteger(page) && page >= sel.from && page <= sel.to;
      });
    }
  }
  if (pool.length < quiz.count) {
    fail(409, `only ${pool.length} approved questions are available; ${quiz.count} are needed`, { available: pool.length });
  }
  pool.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (pool.length > quiz.count) {
    // A seeded draw, reproducible from the sitting key.
    const r = drbg(secret, 'draw');
    for (let i = pool.length - 1; i > 0; i--) {
      const j = r.int(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool = pool.slice(0, quiz.count);
  }
  return pool;
}

export async function publish(ctx) {
  const { quiz, course, user, tier } = await quizFor(ctx, ctx.params.id);
  if (quiz.status !== 'draft') fail(409, `the quiz is already ${quiz.status}`);
  const errs = validateConfig({ tier: course.tier, duration: quiz.duration, pace: quiz.pace, count: quiz.count, grace: quiz.grace });
  if (errs.length) fail(400, errs.join('; '));
  if (quiz.open_sitting) goldOnly(ctx, tier, 'open_sitting');
  if (!quiz.open_sitting && !quiz.roster_size) {
    fail(409, 'upload the class roster first (an open sitting, without a roster, needs Gold Certified status)');
  }
  const secret = toHex(randomBytes(32));
  const questions = await chooseQuestions(ctx, quiz, secret);
  const spares = Math.max(10, Math.ceil(0.2 * quiz.roster_size));
  const capacity = quiz.open_sitting ? OPEN_CAPACITY : quiz.roster_size + spares;
  try {
    prepareSitting(questions.map((q) => q.id), secret, capacity);
  } catch (e) {
    if (e.code === 'CAPACITY') fail(409, `${e.message}; add questions or reduce the seats`);
    throw e;
  }
  let code;
  for (let i = 0; i < 5 && !code; i++) {
    const c = randomCode(6);
    if (!(await ctx.one('SELECT 1 FROM quizzes WHERE code = ?', c))) code = c;
  }
  if (!code) fail(500, 'could not allocate a quiz code');
  await ctx.batch([
    ...questions.map((q) => ['INSERT INTO quiz_questions (quiz_id, question_id, version, body) VALUES (?, ?, ?, ?)', quiz.id, q.id, q.version, q.body]),
    ["UPDATE quizzes SET status = 'published', secret = ?, capacity = ?, next_spare = ?, code = ?, gold = ?, published_at = ? WHERE id = ? AND status = 'draft'",
      secret, capacity, quiz.open_sitting ? 0 : quiz.roster_size, code, tier === 'gold' ? 1 : 0, ctx.now, quiz.id],
  ]);
  await ctx.audit(user.id, 'quiz.published', quiz.id, { count: questions.length, capacity });
  return json({ code, capacity, questions: questions.length, spare_seats: quiz.open_sitting ? null : spares });
}

export async function status(ctx) {
  const { quiz } = await quizFor(ctx, ctx.params.id);
  const c = await ctx.one(
    `SELECT COUNT(*) AS checked_in, SUM(t0 IS NOT NULL) AS started, SUM(status = 'finished') AS finished, SUM(status = 'void') AS void
       FROM attempts WHERE quiz_id = ?`, quiz.id);
  const unlisted = await ctx.one('SELECT COUNT(*) AS n FROM roster WHERE quiz_id = ? AND listed = 0', quiz.id);
  return json({ status: quiz.status, roster: quiz.roster_size, checked_in: c.checked_in, started: c.started ?? 0, finished: c.finished ?? 0, void: c.void ?? 0, unlisted: unlisted.n });
}

async function attemptForOwner(ctx, attemptId) {
  const a = await ctx.one('SELECT * FROM attempts WHERE id = ?', attemptId);
  if (!a) fail(404, 'no such attempt');
  const { quiz, user } = await quizFor(ctx, a.quiz_id);
  return { a, quiz, user };
}

export async function voidAttempt(ctx) {
  const { a, user } = await attemptForOwner(ctx, ctx.params.id);
  const { reason } = await ctx.body();
  if (!String(reason ?? '').trim()) fail(400, 'give a reason');
  await ctx.run("UPDATE attempts SET status = 'void', void_reason = ?, score = 0, percent = 0 WHERE id = ?", String(reason).slice(0, 500), a.id);
  await ctx.audit(user.id, 'attempt.void', a.id, { reason });
  return json({ ok: true });
}

export async function resetAttempt(ctx) {
  const { a, user } = await attemptForOwner(ctx, ctx.params.id);
  const { reason } = await ctx.body();
  if (!String(reason ?? '').trim()) fail(400, 'give a reason');
  await ctx.batch([
    ['DELETE FROM answers WHERE attempt_id = ?', a.id],
    ["UPDATE attempts SET t0 = NULL, status = 'checked-in', result = NULL, score = NULL, max = NULL, percent = NULL, result_id = NULL, finished_at = NULL, void_reason = NULL WHERE id = ?", a.id],
  ]);
  await ctx.audit(user.id, 'attempt.reset', a.id, { reason, previous: a.status });
  return json({ ok: true });
}
