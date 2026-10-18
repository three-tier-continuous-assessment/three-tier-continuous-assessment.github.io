// Sitting a quiz (brief §4, §5): the public card, check-in, start, server-gated slots, answers,
// and lazy grading.

import { json, fail, randomId, hashCode, signToken, parseJSONColumn } from './util.mjs';
import { limit } from './app.mjs';
import { upsertGoogleUser } from './identity.mjs';
import { prepareSitting, seatOrder, optionOrder, letterToOption, LETTERS } from '../../shared/order.mjs';
import { currentSlot, acceptsAnswer, attemptEnd, slotWindow } from '../../shared/timing.mjs';
import { gradeAttempt, scaled, grade, BAND_PRESETS } from '../../shared/grade.mjs';

const MAX_TEXT_ANSWER = 200;

async function publishedQuiz(ctx, code) {
  const z = await ctx.one("SELECT * FROM quizzes WHERE code = ? AND status IN ('published', 'closed')", String(code ?? '').toUpperCase());
  if (!z) fail(404, 'no quiz has this code');
  return z;
}

export async function quizCard(ctx, z) {
  const course = await ctx.one('SELECT code, title, institution, tier FROM courses WHERE id = ?', z.course_id);
  const owner = await ctx.one('SELECT name FROM users WHERE id = ?', z.owner_id);
  return {
    code: z.code, title: z.title, label: z.label, status: z.status, course, lecturer: owner?.name ?? null,
    duration: z.duration, pace: z.pace, count: z.count, grace: z.grace, opens_at: z.opens_at, last_start: z.last_start,
    open_sitting: !!z.open_sitting, roster: z.roster_size > 0, gold: !!z.gold,
    length_seconds: z.count * z.pace,
    server_now: ctx.now,
  };
}

export async function card(ctx) {
  return json(await quizCard(ctx, await publishedQuiz(ctx, ctx.params.code)));
}

// ---------------------------------------------------------------- check-in

async function sittingOf(ctx, z) {
  const ids = (await ctx.all('SELECT question_id FROM quiz_questions WHERE quiz_id = ?', z.id)).map((r) => r.question_id);
  return prepareSitting(ids, z.secret, z.capacity);
}

async function spareSeat(ctx, z) {
  const row = await ctx.one('UPDATE quizzes SET next_spare = next_spare + 1 WHERE id = ? AND next_spare < capacity RETURNING next_spare - 1 AS seat', z.id);
  if (!row) fail(409, 'all seats for this quiz are taken; ask the lecturer');
  return row.seat;
}

async function openAttempt(ctx, z, seat, candidate) {
  let a = await ctx.one('SELECT * FROM attempts WHERE quiz_id = ? AND seat = ?', z.id, seat);
  if (!a) {
    const order = seatOrder(await sittingOf(ctx, z), seat);
    const id = randomId('a_');
    await ctx.run(
      'INSERT INTO attempts (id, quiz_id, seat, candidate, question_order, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(quiz_id, seat) DO NOTHING',
      id, z.id, seat, JSON.stringify(candidate), JSON.stringify(order), ctx.now,
    );
    a = await ctx.one('SELECT * FROM attempts WHERE quiz_id = ? AND seat = ?', z.id, seat);
  }
  // The newest session wins: a fresh nonce invalidates any other device's token.
  const nonce = randomId();
  await ctx.run('UPDATE attempts SET session_nonce = ? WHERE id = ?', nonce, a.id);
  if (a.session_nonce) await ctx.audit(`attempt:${a.id}`, 'attempt.session.replaced', a.id, null);
  const expires = Math.max(ctx.now, z.last_start ?? ctx.now) + (z.count * z.pace + 86_400) * 1000;
  return { token: signToken(ctx.secrets.SESSION_KEY, { k: 'a', aid: a.id, n: nonce, exp: expires }), attempt: a };
}

export async function checkin(ctx) {
  const z = await publishedQuiz(ctx, ctx.params.code);
  if (z.status !== 'published') fail(409, 'this quiz is closed');
  if (z.last_start && ctx.now > z.last_start) fail(403, 'check-in for this quiz has closed');
  // A whole class may share one address (campus Wi-Fi, carrier NAT): limit per IP only against floods.
  await limit(ctx, `checkin-ip:${z.id}:${ctx.ip}`, 5000, 600);
  const b = await ctx.body();
  let seat, candidate;

  if (b.via === 'code') {
    const row = await ctx.one('SELECT * FROM roster WHERE quiz_id = ? AND code_hash = ?', z.id, hashCode(b.code));
    if (!row) {
      await limit(ctx, `badcode:${z.id}:${ctx.ip}`, 20, 600); // guessing codes is what needs stopping
      fail(403, 'that code is not valid for this quiz');
    }
    seat = row.seat;
    candidate = { name: row.full_name, reg_no: row.reg_no, listed: true, self_declared: false };
  } else if (b.via === 'google') {
    const { user } = await upsertGoogleUser(ctx, b.id_token);
    await limit(ctx, `checkin-sub:${z.id}:${user.google_sub}`, 10, 600);
    if (z.open_sitting) {
      const existing = await ctx.one('SELECT seat FROM roster WHERE quiz_id = ? AND bound_sub = ?', z.id, user.google_sub);
      const name = String(b.name ?? user.name ?? '').trim().slice(0, 120);
      if (!name) fail(400, 'enter your full name');
      candidate = { name, reg_no: String(b.reg_no ?? '').trim().slice(0, 40) || null, email: user.email, listed: false, self_declared: true };
      if (existing) seat = existing.seat;
      else {
        seat = await spareSeat(ctx, z);
        try {
          await ctx.run('INSERT INTO roster (quiz_id, seat, reg_no, full_name, email, listed, confirmed, bound_sub) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
            z.id, seat, `open:${seat}`, name, user.email, user.google_sub);
        } catch {
          // The same account checked in twice at once: keep the seat that won.
          const won = await ctx.one('SELECT seat FROM roster WHERE quiz_id = ? AND bound_sub = ?', z.id, user.google_sub);
          if (!won) throw new Error('check-in race could not be resolved');
          seat = won.seat;
        }
      }
    } else {
      const reg = String(b.reg_no ?? '').trim();
      if (!reg) fail(400, 'enter your registration number');
      const row = await ctx.one('SELECT * FROM roster WHERE quiz_id = ? AND lower(reg_no) = lower(?)', z.id, reg);
      if (row) {
        if (row.email && row.email !== user.email) fail(403, `this registration number is registered to another email address; sign in with ${row.email.replace(/^(.).*(@.*)$/, '$1…$2')}`);
        if (row.bound_sub && row.bound_sub !== user.google_sub) {
          await ctx.audit(user.id, 'checkin.conflict', z.id, { seat: row.seat });
          fail(403, 'this registration number has already been claimed by another account; the lecturer has been told');
        }
        if (!row.bound_sub) await ctx.run('UPDATE roster SET bound_sub = ? WHERE quiz_id = ? AND seat = ?', user.google_sub, z.id, row.seat);
        seat = row.seat;
        candidate = { name: row.full_name ?? user.name, reg_no: row.reg_no, email: user.email, listed: true, self_declared: !row.full_name };
      } else {
        const mine = await ctx.one('SELECT seat FROM roster WHERE quiz_id = ? AND bound_sub = ?', z.id, user.google_sub);
        if (mine) fail(409, 'this account has already checked in under another registration number');
        seat = await spareSeat(ctx, z);
        try {
          await ctx.run('INSERT INTO roster (quiz_id, seat, reg_no, full_name, email, listed, confirmed, bound_sub) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
            z.id, seat, reg, user.name, user.email, user.google_sub);
        } catch {
          fail(409, 'this registration number has just been claimed; ask the lecturer');
        }
        candidate = { name: user.name, reg_no: reg, email: user.email, listed: false, self_declared: true };
      }
    }
  } else {
    fail(400, 'check in with your code or with Google');
  }

  const { token, attempt } = await openAttempt(ctx, z, seat, candidate);
  const stored = parseJSONColumn(attempt.candidate, candidate);
  return json({
    token,
    candidate: { name: stored.name, reg_no: stored.reg_no, listed: stored.listed, self_declared: stored.self_declared },
    status: attempt.status,
    quiz: await quizCard(ctx, z),
  });
}

// ---------------------------------------------------------------- the running attempt

export async function requireAttempt(ctx) {
  const s = ctx.session();
  if (!s || s.k !== 'a') fail(401, 'check in to the quiz first');
  const a = await ctx.one('SELECT * FROM attempts WHERE id = ?', s.aid);
  if (!a) fail(401, 'check in again');
  if (a.session_nonce !== s.n) fail(409, 'this quiz was opened on another device; continue there, or check in again here', { replaced: true });
  const z = await ctx.one('SELECT * FROM quizzes WHERE id = ?', a.quiz_id);
  return { a, z };
}

function timing(ctx, a, z) {
  return { t0: a.t0, server_now: ctx.now, pace: z.pace, count: z.count, grace: z.grace, ends_at: a.t0 ? attemptEnd(a.t0, z.pace, z.count, z.grace) : null };
}

export async function start(ctx) {
  const { a, z } = await requireAttempt(ctx);
  if (a.status === 'void') fail(403, 'this attempt has been voided by the lecturer');
  if (a.t0) return json({ status: a.status, ...timing(ctx, a, z) });
  if (z.status !== 'published') fail(409, 'this quiz is closed');
  if (z.opens_at && ctx.now < z.opens_at) fail(425, 'the quiz has not opened yet', { opens_at: z.opens_at, server_now: ctx.now });
  if (z.last_start && ctx.now > z.last_start) fail(403, 'the time to start this quiz has passed');
  await ctx.run("UPDATE attempts SET t0 = ?, status = 'started' WHERE id = ? AND t0 IS NULL", ctx.now, a.id);
  const fresh = await ctx.one('SELECT * FROM attempts WHERE id = ?', a.id);
  await ctx.audit(`attempt:${a.id}`, 'attempt.started', a.id, null);
  return json({ status: fresh.status, ...timing(ctx, fresh, z) });
}

const displayOptions = (z, a, q) => {
  const body = q.body;
  if (body.type !== 'mcq' && body.type !== 'tf') return null;
  return optionOrder(z.secret, a.seat, q.question_id, body.options.map((o) => o.id), { fixed: !!body.fixed_options || body.type === 'tf' });
};

async function sittingQuestion(ctx, z, qid) {
  const row = await ctx.one('SELECT question_id, body FROM quiz_questions WHERE quiz_id = ? AND question_id = ?', z.id, qid);
  return { question_id: row.question_id, body: JSON.parse(row.body) };
}

export async function slot(ctx) {
  const { a, z } = await requireAttempt(ctx);
  if (a.status === 'void') return json({ void: true, reason: a.void_reason });
  if (!a.t0) fail(409, 'press Start first', { needs_start: true, server_now: ctx.now });
  const k = currentSlot(a.t0, z.pace, z.count, ctx.now);
  if (k > z.count) {
    await finalize(ctx, a, z);
    return json({ finished: true, ...timing(ctx, a, z) });
  }
  const order = JSON.parse(a.question_order);
  const q = await sittingQuestion(ctx, z, order[k - 1]);
  const display = displayOptions(z, a, q);
  const prior = await ctx.one('SELECT choice FROM answers WHERE attempt_id = ? AND slot = ?', a.id, k);
  let answered = null;
  if (prior) answered = display ? LETTERS[display.indexOf(prior.choice)] ?? null : prior.choice;
  const w = slotWindow(a.t0, z.pace, k);
  return json({
    slot: k,
    count: z.count,
    opens_at: w.open,
    closes_at: w.close,
    server_now: ctx.now,
    answered,
    question: {
      type: q.body.type,
      stem: q.body.stem,
      options: display ? display.map((id, i) => ({ letter: LETTERS[i], text: q.body.options.find((o) => o.id === id).text })) : null,
    },
  });
}

export async function answer(ctx) {
  const { a, z } = await requireAttempt(ctx);
  if (a.status === 'void') fail(403, 'this attempt has been voided by the lecturer');
  if (!a.t0) fail(409, 'press Start first');
  const b = await ctx.body();
  const k = Number(b.slot);
  if (!acceptsAnswer(a.t0, z.pace, z.count, z.grace, k, ctx.now)) {
    fail(409, 'the time for this question is over; your answer was not recorded', { late: true, server_now: ctx.now });
  }
  const order = JSON.parse(a.question_order);
  const q = await sittingQuestion(ctx, z, order[k - 1]);
  const display = displayOptions(z, a, q);
  let choice;
  if (b.choice === null || b.choice === '') choice = null;
  else if (display) {
    choice = letterToOption(display, b.choice);
    if (!choice) fail(400, 'choose one of the options');
  } else {
    choice = String(b.choice).trim().slice(0, MAX_TEXT_ANSWER);
  }
  await ctx.run(
    'INSERT INTO answers (attempt_id, slot, choice, received_at) VALUES (?, ?, ?, ?) ON CONFLICT(attempt_id, slot) DO UPDATE SET choice = excluded.choice, received_at = excluded.received_at',
    a.id, k, choice, ctx.now,
  );
  return json({ ok: true, slot: k, server_now: ctx.now });
}

// ---------------------------------------------------------------- grading

/** Grades an attempt once its last slot has closed (lazy: no background job). Idempotent. */
export async function finalize(ctx, a, z, { force = false } = {}) {
  if (a.status === 'finished' || a.status === 'void') return a;
  if (!a.t0) return a;
  if (!force && ctx.now < attemptEnd(a.t0, z.pace, z.count, z.grace)) return a;
  const order = JSON.parse(a.question_order);
  const rows = await ctx.all('SELECT question_id, body FROM quiz_questions WHERE quiz_id = ?', z.id);
  const byId = new Map(rows.map((r) => [r.question_id, { id: r.question_id, ...JSON.parse(r.body) }]));
  const questions = order.map((id) => byId.get(id));
  const answersBySlot = await ctx.all('SELECT slot, choice FROM answers WHERE attempt_id = ?', a.id);
  const answers = {};
  for (const r of answersBySlot) answers[order[r.slot - 1]] = r.choice;
  const g = gradeAttempt(questions, answers);
  const result = {
    attempted: g.attempted, correct: g.correct, wrong: g.wrong, unanswered: g.unanswered,
    score: g.score, max: g.max, percent: g.percent,
    scaled: scaled(g.score, g.max, z.scale_to), scale_to: z.scale_to,
    grade: grade(g.percent, BAND_PRESETS[z.bands]),
    items: g.items.map((i) => ({ id: i.id, answered: i.answered, correct: i.correct })),
  };
  const resultId = randomId('r_');
  await ctx.run(
    "UPDATE attempts SET status = 'finished', result = ?, score = ?, max = ?, percent = ?, result_id = ?, finished_at = ? WHERE id = ? AND status NOT IN ('finished', 'void')",
    JSON.stringify(result), g.score, g.max, g.percent, resultId, ctx.now, a.id,
  );
  return ctx.one('SELECT * FROM attempts WHERE id = ?', a.id);
}
