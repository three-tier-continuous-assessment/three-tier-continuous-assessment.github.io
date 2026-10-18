// Payments, entitlements and reports (brief §6, §7). An item unlocks only after the Worker has
// verified the payment with Paystack; the browser's word is never enough.

import { json, fail, randomId, parseJSONColumn } from './util.mjs';
import { requireLecturer, limit } from './app.mjs';
import { requireAttempt, finalize } from './sitting.mjs';
import { quizFor } from './quizzes.mjs';
import { itemAnalysis } from '../../shared/grade.mjs';

const ENTITLEMENT = { student_result: 'student_result', bulk_unlock: 'student_result', class_report: 'class_report' };

export async function pricing(ctx) {
  return json(ctx.config.pricing);
}

const reportTarget = (quizId, userId) => `${quizId}:${userId}`;

async function entitled(ctx, product, target) {
  return !!(await ctx.one('SELECT 1 FROM entitlements WHERE product = ? AND target = ?', product, target));
}

/** Verifies one payment with Paystack and, if it is paid in full, grants its entitlements. */
export async function settle(ctx, reference) {
  const p = await ctx.one('SELECT * FROM payments WHERE reference = ?', reference);
  if (!p) fail(404, 'no such payment');
  if (p.status === 'success') return { status: 'success' };
  let v;
  try {
    v = await ctx.services.paystack.verify(reference);
  } catch {
    return { status: p.status };
  }
  if (v.status === 'success') {
    if (v.amountKobo !== p.amount_kobo || v.currency !== p.currency) {
      await ctx.run("UPDATE payments SET status = 'mismatch', verified_at = ? WHERE reference = ?", ctx.now, reference);
      await ctx.audit('paystack', 'payment.mismatch', reference, { expected: p.amount_kobo, paid: v.amountKobo, currency: v.currency });
      return { status: 'mismatch' };
    }
    const targets = parseJSONColumn(p.targets, []);
    const product = ENTITLEMENT[p.product];
    await ctx.batch([
      ["UPDATE payments SET status = 'success', verified_at = ? WHERE reference = ? AND status != 'success'", ctx.now, reference],
      ...targets.map((t) => ['INSERT INTO entitlements (product, target, reference, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT(product, target) DO NOTHING', product, t, reference, ctx.now]),
    ]);
    await ctx.audit('paystack', 'payment.success', reference, { product: p.product, targets: targets.length });
    return { status: 'success' };
  }
  if (v.status === 'failed' || v.status === 'reversed') {
    await ctx.run('UPDATE payments SET status = ?, verified_at = ? WHERE reference = ?', v.status, ctx.now, reference);
    return { status: v.status };
  }
  return { status: 'pending' };
}

/** Lazy settlement: before refusing an item, settle any recent pending payment for it. */
async function settlePendingFor(ctx, product, target) {
  const rows = await ctx.all(
    `SELECT p.reference FROM payment_targets t JOIN payments p ON p.reference = t.reference
      WHERE t.product = ? AND t.target = ? AND p.status = 'pending' AND p.created_at > ?`,
    product, target, ctx.now - 7 * 86_400_000,
  );
  for (const r of rows) await settle(ctx, r.reference);
  return entitled(ctx, product, target);
}

function priceOf(ctx, product) {
  const p = ctx.config.pricing.products[product];
  if (!p) fail(400, 'unknown product');
  return { price: p.price, currency: ctx.config.pricing.currency, unit: p.unit, product };
}

// ---------------------------------------------------------------- the student's result

async function resultPayload(ctx, a, z) {
  const r = parseJSONColumn(a.result, {});
  const course = await ctx.one('SELECT code, title, institution FROM courses WHERE id = ?', z.course_id);
  const c = parseJSONColumn(a.candidate, {});
  const out = {
    candidate: { name: c.name, reg_no: c.reg_no, self_declared: !!c.self_declared, listed: !!c.listed },
    quiz: { title: z.title, label: z.label, course, date: a.t0 },
    attempted: r.attempted, correct: r.correct, wrong: r.wrong, unanswered: r.unanswered,
    score: r.score, max: r.max, percent: r.percent, scaled: r.scaled, scale_to: r.scale_to, grade: r.grade,
    result_id: a.result_id, generated_at: a.finished_at,
  };
  if (z.gold) out.gold = await goldMark(ctx, z.owner_id);
  return out;
}

async function goldMark(ctx, ownerId) {
  const owner = await ctx.one('SELECT name, email FROM users WHERE id = ?', ownerId);
  const ids = await ctx.all("SELECT method, identifier FROM verifications WHERE user_id = ? AND status = 'passed' AND level = 2", ownerId);
  const nin = await ctx.one("SELECT 1 AS ok FROM verifications WHERE user_id = ? AND status = 'passed' AND level = 3", ownerId);
  return {
    lecturer: owner?.name ?? null,
    institution: owner?.email?.split('@')[1] ?? null,
    identifiers: ids.map((v) => ({ method: v.method, identifier: v.identifier })),
    nin_verified: !!nin,
  };
}

export async function studentResult(ctx) {
  let { a, z } = await requireAttempt(ctx);
  a = await finalize(ctx, a, z);
  if (a.status === 'void') return json({ void: true, reason: a.void_reason });
  if (a.status !== 'finished') fail(409, 'the quiz is still running', { ends_at: a.t0 ? a.t0 + (z.count * z.pace + z.grace) * 1000 : null });
  const ok = (await entitled(ctx, 'student_result', a.id)) || (await settlePendingFor(ctx, 'student_result', a.id));
  if (!ok) return json({ error: 'payment required', ...priceOf(ctx, 'student_result') }, 402);
  return json(await resultPayload(ctx, a, z));
}

// ---------------------------------------------------------------- the class report

const round2 = (x) => Math.round(x * 100) / 100;

function statistics(scores, passMark) {
  const n = scores.length;
  if (!n) return { submissions: 0 };
  const sorted = [...scores].sort((x, y) => x - y);
  const mean = scores.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9.99, count: 0 }));
  for (const s of scores) bins[Math.min(9, Math.floor(s / 10))].count++;
  return {
    submissions: n, mean: round2(mean), median: round2(median), sd: round2(sd),
    highest: sorted[n - 1], lowest: sorted[0],
    pass_mark: passMark, pass_rate: round2((100 * scores.filter((s) => s >= passMark).length) / n),
    distribution: bins,
  };
}

export async function classReport(ctx) {
  const { quiz: z, user } = await quizFor(ctx, ctx.params.id);
  if (z.status === 'draft') fail(409, 'the quiz has not been published');
  const target = reportTarget(z.id, user.id);
  const ok = (await entitled(ctx, 'class_report', target)) || (await settlePendingFor(ctx, 'class_report', target));
  if (!ok) return json({ error: 'payment required', ...priceOf(ctx, 'class_report') }, 402);

  let attempts = await ctx.all('SELECT * FROM attempts WHERE quiz_id = ?', z.id);
  attempts = await Promise.all(attempts.map((a) => finalize(ctx, a, z)));
  const bySeat = new Map(attempts.map((a) => [a.seat, a]));
  const roster = await ctx.all('SELECT * FROM roster WHERE quiz_id = ? ORDER BY seat', z.id);
  const course = await ctx.one('SELECT code, title, institution, tier FROM courses WHERE id = ?', z.course_id);
  const rows = roster.map((r) => {
    const a = bySeat.get(r.seat);
    const res = a ? parseJSONColumn(a.result, null) : null;
    const c = a ? parseJSONColumn(a.candidate, {}) : {};
    const status = !a || !a.t0 ? 'absent' : a.status === 'void' ? 'void' : a.status === 'finished' ? 'finished' : 'in progress';
    return {
      seat: r.seat,
      reg_no: r.reg_no.startsWith('open:') ? c.reg_no ?? '' : r.reg_no,
      name: c.name ?? r.full_name,
      listed: !!r.listed, confirmed: !!r.confirmed, status,
      void_reason: a?.void_reason ?? null,
      attempted: res?.attempted ?? null, correct: res?.correct ?? null, wrong: res?.wrong ?? null, unanswered: res?.unanswered ?? null,
      score: status === 'void' ? 0 : res?.score ?? null, max: res?.max ?? z.count, percent: status === 'void' ? 0 : res?.percent ?? null,
      scaled: res?.scaled ?? null, grade: res?.grade ?? null, result_id: a?.result_id ?? null, attempt_id: a?.id ?? null,
    };
  });
  const finished = attempts.filter((a) => a.status === 'finished');
  const matrix = finished.map((a) => {
    const res = parseJSONColumn(a.result, { items: [] });
    return { total: res.score, correct: new Set(res.items.filter((i) => i.correct).map((i) => i.id)) };
  });
  const qrows = await ctx.all('SELECT question_id, body FROM quiz_questions WHERE quiz_id = ?', z.id);
  const ia = itemAnalysis(qrows.map((q) => q.question_id), matrix);
  return json({
    quiz: { id: z.id, title: z.title, label: z.label, code: z.code, duration: z.duration, pace: z.pace, count: z.count, scale_to: z.scale_to, bands: z.bands, published_at: z.published_at },
    course,
    lecturer: user.name,
    rows,
    stats: { candidates: roster.length, ...statistics(finished.map((a) => a.percent), z.pass_mark) },
    items: qrows.map((q) => ({ id: q.question_id, stem: JSON.parse(q.body).stem, ...ia[q.question_id] })),
    gold: z.gold ? await goldMark(ctx, z.owner_id) : null,
  });
}

// ---------------------------------------------------------------- payments

export async function init(ctx) {
  const b = await ctx.body();
  const product = b.product;
  const { price, currency } = priceOf(ctx, product);
  let targets, email, subject;
  if (product === 'student_result') {
    const { a } = await requireAttempt(ctx);
    if (a.status !== 'finished') fail(409, 'the result is not ready yet');
    if (await entitled(ctx, 'student_result', a.id)) return json({ entitled: true });
    targets = [a.id];
    email = String(b.email ?? parseJSONColumn(a.candidate, {}).email ?? '').trim().toLowerCase();
    subject = `attempt:${a.id}`;
  } else if (product === 'class_report' || product === 'bulk_unlock') {
    const { quiz: z, user } = await quizFor(ctx, b.quiz_id);
    if (z.status === 'draft') fail(409, 'the quiz has not been published');
    email = user.email;
    subject = user.id;
    if (product === 'class_report') {
      const t = reportTarget(z.id, user.id);
      if (await entitled(ctx, 'class_report', t)) return json({ entitled: true });
      targets = [t];
    } else {
      const ids = Array.isArray(b.attempt_ids) ? b.attempt_ids : [];
      const rows = ids.length ? await ctx.all(`SELECT id FROM attempts WHERE quiz_id = ? AND status = 'finished' AND id IN (${ids.map(() => '?').join(',')})`, z.id, ...ids) : [];
      const open = [];
      for (const r of rows) if (!(await entitled(ctx, 'student_result', r.id))) open.push(r.id);
      if (!open.length) fail(400, 'choose finished candidates whose results are still locked');
      targets = open;
    }
  } else {
    fail(400, 'unknown product');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Paystack needs the payer\'s email address');
  await limit(ctx, `payinit:${subject}`, 10, 600);
  const units = product === 'bulk_unlock' ? targets.length : 1;
  const amountKobo = Math.round(price * units * 100);
  const reference = `ttca_${randomId()}`;
  await ctx.batch([
    ['INSERT INTO payments (reference, product, targets, amount_kobo, currency, payer_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      reference, product, JSON.stringify(targets), amountKobo, currency, email, ctx.now],
    ...targets.map((t) => ['INSERT INTO payment_targets (reference, product, target) VALUES (?, ?, ?)', reference, ENTITLEMENT[product], t]),
  ]);
  const site = String(ctx.secrets.SITE_ORIGIN ?? '').replace(/\/$/, '');
  const r = await ctx.services.paystack.initialize({
    email, amountKobo, reference, callbackUrl: `${site}/#/paid/${reference}`, metadata: { product, targets: targets.length },
  });
  return json({ reference, authorization_url: r.authorizationUrl, amount: price * units, currency, test: !!ctx.services.paystack.fake });
}

export async function verify(ctx) {
  const { reference } = await ctx.body();
  if (!/^ttca_[0-9a-f]{24}$/.test(String(reference))) fail(400, 'bad reference');
  await limit(ctx, `payverify:${ctx.ip}`, 60, 600);
  return json(await settle(ctx, reference));
}

export async function webhook(ctx) {
  const raw = await ctx.request.text();
  const sig = ctx.request.headers.get('x-paystack-signature');
  if (!(await ctx.services.paystack.verifySignature(raw, sig))) return json({ error: 'bad signature' }, 401);
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'bad body' }, 400); }
  if (event.event === 'charge.success' && /^ttca_/.test(event.data?.reference ?? '')) {
    const known = await ctx.one('SELECT 1 FROM payments WHERE reference = ?', event.data.reference);
    if (known) await settle(ctx, event.data.reference);
  }
  return json({ ok: true });
}

export async function testComplete(ctx) {
  if (!ctx.services.paystack.fake) fail(404, 'not found');
  const { reference } = await ctx.body();
  if (!ctx.services.paystack.complete(reference)) fail(404, 'no such test payment');
  return json(await settle(ctx, reference));
}

export async function verifyResult(ctx) {
  const a = await ctx.one("SELECT * FROM attempts WHERE result_id = ? AND status = 'finished'", ctx.params.id);
  if (!a) fail(404, 'no result has this ID');
  const z = await ctx.one('SELECT * FROM quizzes WHERE id = ?', a.quiz_id);
  const course = await ctx.one('SELECT code, title, institution FROM courses WHERE id = ?', z.course_id);
  const c = parseJSONColumn(a.candidate, {});
  const initials = String(c.name ?? '').split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ');
  return json({
    initials, quiz: z.title, course, date: a.t0, score: a.score, max: a.max, percent: a.percent,
    grade: parseJSONColumn(a.result, {}).grade ?? null, gold: z.gold ? await goldMark(ctx, z.owner_id) : null,
  });
}
