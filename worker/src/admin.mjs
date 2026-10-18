// Platform administration (brief §5.6, §6.2): the verification queue, revocation, suspension,
// and payment reconciliation. Administrators are the accounts in ADMIN_EMAILS.

import { json, fail, hashCode } from './util.mjs';
import { requireUser, isAdmin } from './app.mjs';

async function requireAdmin(ctx) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx, user)) fail(403, 'administrators only');
  return user;
}

export async function verifications(ctx) {
  await requireAdmin(ctx);
  const status = ctx.url.searchParams.get('status') ?? 'review';
  const rows = await ctx.all(
    `SELECT v.id, v.level, v.method, v.identifier, v.status, v.note, v.created_at, u.id AS user_id, u.name, u.email
       FROM verifications v JOIN users u ON u.id = v.user_id
      WHERE v.status = ? AND v.level IN (2, 3) ORDER BY v.created_at`, status);
  return json({ items: rows });
}

export async function decide(ctx) {
  const admin = await requireAdmin(ctx);
  const v = await ctx.one('SELECT * FROM verifications WHERE id = ?', ctx.params.id);
  if (!v || v.level === 1) fail(404, 'no such verification');
  if (v.status !== 'review') fail(409, `this verification is ${v.status}`);
  const { decision, observed_code, note } = await ctx.body();
  if (!['pass', 'fail'].includes(decision)) fail(400, 'decision must be pass or fail');
  if (decision === 'pass' && v.level === 2) {
    // The reviewer types the code they see on the public profile; it must match the one issued.
    if (!observed_code || hashCode(observed_code) !== v.code_hash) fail(400, 'the code you saw on the profile does not match the code issued');
  }
  const status = decision === 'pass' ? 'passed' : 'failed';
  await ctx.run('UPDATE verifications SET status = ?, reviewer = ?, note = ?, checked_at = ? WHERE id = ?',
    status, admin.email, String(note ?? '').slice(0, 500) || null, ctx.now, v.id);
  await ctx.audit(admin.email, `level${v.level}.${status}`, v.user_id, { verification: v.id, method: v.method });
  return json({ id: v.id, status });
}

export async function revoke(ctx) {
  const admin = await requireAdmin(ctx);
  const { user_id, level, reason } = await ctx.body();
  if (![1, 2, 3].includes(level)) fail(400, 'level must be 1, 2 or 3');
  if (!String(reason ?? '').trim()) fail(400, 'give a reason');
  const r = await ctx.run("UPDATE verifications SET status = 'revoked', note = ?, reviewer = ?, checked_at = ? WHERE user_id = ? AND level = ? AND status = 'passed'",
    String(reason).slice(0, 500), admin.email, ctx.now, user_id, level);
  await ctx.audit(admin.email, `level${level}.revoked`, user_id, { reason });
  return json({ revoked: r.meta?.changes ?? 0 });
}

export async function suspend(ctx) {
  const admin = await requireAdmin(ctx);
  const { user_id, suspended = true, reason } = await ctx.body();
  await ctx.run('UPDATE users SET suspended = ? WHERE id = ?', suspended ? 1 : 0, user_id);
  await ctx.audit(admin.email, suspended ? 'user.suspended' : 'user.restored', user_id, { reason });
  return json({ ok: true });
}

export async function reconcile(ctx) {
  await requireAdmin(ctx);
  const from = Number(ctx.url.searchParams.get('from') ?? ctx.now - 7 * 86_400_000);
  const to = Number(ctx.url.searchParams.get('to') ?? ctx.now);
  const remote = await ctx.services.paystack.list({ from, to });
  const local = await ctx.all('SELECT reference, status, amount_kobo, currency FROM payments WHERE created_at BETWEEN ? AND ?', from, to);
  const byRef = new Map(local.map((p) => [p.reference, p]));
  const items = [];
  for (const t of remote) {
    if (!String(t.reference).startsWith('ttca_')) continue;
    const p = byRef.get(t.reference);
    if (!p) items.push({ reference: t.reference, problem: 'paid at Paystack but unknown here' });
    else if (t.status === 'success' && p.status !== 'success') items.push({ reference: t.reference, problem: `paid at Paystack but ${p.status} here` });
    else if (t.status !== 'success' && p.status === 'success') items.push({ reference: t.reference, problem: `success here but ${t.status} at Paystack` });
    else if (t.status === 'success' && (t.amountKobo !== p.amount_kobo || t.currency !== p.currency)) items.push({ reference: t.reference, problem: 'amount or currency differs' });
  }
  return json({ from, to, checked: remote.length, items });
}
