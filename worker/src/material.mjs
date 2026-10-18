// My Material (brief §2): courses, notes, transcription, selection, CA schedules, generation
// with grounding and re-solve, pool import, AI assist, and review.

import { json, fail, randomId, parseJSONColumn } from './util.mjs';
import { requireLecturer, limit } from './app.mjs';
import { costUSD } from './services/ai.mjs';
import { TIERS, defaultCount } from '../../shared/timing.mjs';
import { sha256Hex } from '../../shared/sha256.mjs';
import { numberPages, resolveSelection, extractSelection } from '../../shared/notes.mjs';
import { parseSchedule } from '../../shared/parse/schedule.mjs';
import { parsePool } from '../../shared/parse/index.mjs';
import { makeOptions, trueFalse, needsFixedOptions, validateQuestion } from '../../shared/question.mjs';
import { checkGenerated } from '../../shared/grounding.mjs';
import { normalizeShort, parseNumber } from '../../shared/grade.mjs';

const MAX_PAGES = 400;
const MAX_PAGE_CHARS = 20_000;
const MAX_IMAGE_B64 = 1_600_000;
const BATCH = 30;

// ---------------------------------------------------------------- access

export async function courseFor(ctx, courseId, { ownerOnly = false } = {}) {
  const lec = await requireLecturer(ctx);
  const c = await ctx.one('SELECT * FROM courses WHERE id = ?', courseId);
  const co = parseJSONColumn(c?.co_lecturers, []);
  const allowed = c && (c.owner_id === lec.user.id || (!ownerOnly && co.includes(String(lec.user.email).toLowerCase())));
  if (!allowed) fail(404, 'no such course');
  return { ...lec, course: c };
}

async function coursePages(ctx, courseId) {
  const files = await ctx.all('SELECT * FROM notes WHERE course_id = ? ORDER BY position', courseId);
  const out = [];
  for (const f of files) {
    const pages = await ctx.all('SELECT idx, printed, text FROM note_pages WHERE note_id = ? ORDER BY idx', f.id);
    out.push({ id: f.id, name: f.name, firstPage: f.first_page, pages: pages.map((p) => ({ text: p.text, printed: p.printed ?? undefined })) });
  }
  return numberPages(out);
}

/** Flags questions whose source page changed since they were written. */
async function markSourceChanges(ctx, courseId) {
  const { pages } = await coursePages(ctx, courseId);
  const hashByPage = new Map(pages.map((p) => [p.number, p.hash]));
  const qs = await ctx.all("SELECT id, source FROM questions WHERE course_id = ? AND status != 'retired'", courseId);
  const stmts = [];
  for (const q of qs) {
    const s = parseJSONColumn(q.source, {});
    if (!s.page_hash) continue;
    const changed = hashByPage.get(s.page) !== s.page_hash ? 1 : 0;
    stmts.push(['UPDATE questions SET source_changed = ? WHERE id = ?', changed, q.id]);
  }
  if (stmts.length) await ctx.batch(stmts);
}

// ---------------------------------------------------------------- AI accounting

export async function aiAllowance(ctx, userId) {
  const row = await ctx.one('SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM ai_usage WHERE user_id = ? AND at > ?', userId, ctx.now - 30 * 86_400_000);
  const quota = ctx.config.tiers.ai_monthly_quota_usd;
  if (row.spent >= quota) fail(429, `this month's AI allowance (US$${quota}) is used up`);
  return quota - row.spent;
}

async function recordUsage(ctx, userId, purpose, usage) {
  const cost = usage.model === 'fake' ? 0 : costUSD(usage.model, usage);
  await ctx.run('INSERT INTO ai_usage (user_id, purpose, model, input_tokens, output_tokens, cost_usd, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId, purpose, usage.model, usage.input_tokens ?? 0, usage.output_tokens ?? 0, cost, ctx.now);
  return cost;
}

// ---------------------------------------------------------------- courses

export async function listCourses(ctx) {
  const { user } = await requireLecturer(ctx);
  const rows = await ctx.all('SELECT * FROM courses WHERE owner_id = ? OR instr(co_lecturers, ?) > 0 ORDER BY created_at DESC',
    user.id, JSON.stringify(String(user.email).toLowerCase()));
  return json({ courses: rows.map((c) => ({ ...c, co_lecturers: parseJSONColumn(c.co_lecturers, []) })) });
}

export async function createCourse(ctx) {
  const { user } = await requireLecturer(ctx);
  const b = await ctx.body();
  if (!String(b.title ?? '').trim()) fail(400, 'a course needs a title');
  if (!TIERS.includes(b.tier)) fail(400, `tier must be one of ${TIERS.join(', ')}`);
  const id = randomId('c_');
  await ctx.run('INSERT INTO courses (id, owner_id, institution, code, title, level, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, user.id, b.institution?.trim() || null, b.code?.trim() || null, b.title.trim(), b.level?.trim() || null, b.tier, ctx.now);
  return json({ id }, 201);
}

export async function updateCourse(ctx) {
  const { course } = await courseFor(ctx, ctx.params.id, { ownerOnly: true });
  const b = await ctx.body();
  if (b.tier !== undefined && !TIERS.includes(b.tier)) fail(400, 'bad tier');
  const co = b.co_lecturers === undefined ? parseJSONColumn(course.co_lecturers, [])
    : b.co_lecturers.map((e) => String(e).trim().toLowerCase()).filter((e) => /@/.test(e));
  await ctx.run('UPDATE courses SET institution = ?, code = ?, title = ?, level = ?, tier = ?, co_lecturers = ? WHERE id = ?',
    b.institution ?? course.institution, b.code ?? course.code, b.title ?? course.title, b.level ?? course.level, b.tier ?? course.tier, JSON.stringify(co), course.id);
  return json({ ok: true });
}

// ---------------------------------------------------------------- notes

export async function listNotes(ctx) {
  const { course } = await courseFor(ctx, ctx.params.id);
  const files = await ctx.all('SELECT * FROM notes WHERE course_id = ? ORDER BY position', course.id);
  for (const f of files) f.pages = await ctx.all('SELECT idx, printed, text, hash, transcribed, confirmed FROM note_pages WHERE note_id = ? ORDER BY idx', f.id);
  const { pages, warnings } = await coursePages(ctx, course.id);
  return json({ files, numbers: pages.map((p) => ({ file: p.fileId, index: p.index, number: p.number })), warnings });
}

export async function addNote(ctx) {
  const { course } = await courseFor(ctx, ctx.params.id);
  const b = await ctx.body();
  if (b.rights !== true) fail(400, 'please confirm that you have the right to use this material');
  const pages = Array.isArray(b.pages) ? b.pages : [];
  if (!pages.length || pages.length > MAX_PAGES) fail(400, `a file needs 1 to ${MAX_PAGES} pages`);
  if (pages.some((p) => typeof p.text !== 'string' || p.text.length > MAX_PAGE_CHARS)) fail(400, `each page must be text of at most ${MAX_PAGE_CHARS} characters`);
  const kinds = ['pdf', 'photo', 'docx', 'tex', 'md', 'txt'];
  if (!kinds.includes(b.kind)) fail(400, `kind must be one of ${kinds.join(', ')}`);
  const pos = await ctx.one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM notes WHERE course_id = ?', course.id);
  const id = randomId('n_');
  const first = Number.isInteger(b.first_page) && b.first_page > 0 ? b.first_page : 1;
  await ctx.batch([
    ['INSERT INTO notes (id, course_id, name, kind, first_page, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, course.id, String(b.name ?? 'Notes').slice(0, 200), b.kind, first, pos.p, ctx.now],
    ...pages.map((p, i) => ['INSERT INTO note_pages (note_id, idx, printed, text, hash, transcribed, confirmed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, i, Number.isInteger(p.printed) ? p.printed : null, p.text, sha256Hex(p.text), p.transcribed ? 1 : 0, p.transcribed ? 0 : 1]),
  ]);
  await markSourceChanges(ctx, course.id);
  return json({ id, pages: pages.length }, 201);
}

async function noteFor(ctx, noteId) {
  const n = await ctx.one('SELECT * FROM notes WHERE id = ?', noteId);
  if (!n) fail(404, 'no such notes file');
  const access = await courseFor(ctx, n.course_id);
  return { ...access, note: n };
}

export async function updateNote(ctx) {
  const { note } = await noteFor(ctx, ctx.params.id);
  const b = await ctx.body();
  const first = Number.isInteger(b.first_page) && b.first_page > 0 ? b.first_page : note.first_page;
  const position = Number.isInteger(b.position) ? b.position : note.position;
  await ctx.run('UPDATE notes SET name = ?, first_page = ?, position = ? WHERE id = ?', String(b.name ?? note.name).slice(0, 200), first, position, note.id);
  await markSourceChanges(ctx, note.course_id);
  return json({ ok: true });
}

export async function deleteNote(ctx) {
  const { note, user } = await noteFor(ctx, ctx.params.id);
  const withQuestions = ctx.url.searchParams.get('with_questions') === '1';
  const stmts = [['DELETE FROM note_pages WHERE note_id = ?', note.id], ['DELETE FROM notes WHERE id = ?', note.id]];
  if (withQuestions) stmts.push(["UPDATE questions SET status = 'retired' WHERE course_id = ? AND json_extract(source, '$.note') = ?", note.course_id, note.id]);
  await ctx.batch(stmts);
  await markSourceChanges(ctx, note.course_id);
  await ctx.audit(user.id, 'notes.deleted', note.id, { with_questions: withQuestions });
  return json({ ok: true });
}

export async function updatePage(ctx) {
  const { note } = await noteFor(ctx, ctx.params.id);
  const idx = Number(ctx.params.idx);
  const page = await ctx.one('SELECT * FROM note_pages WHERE note_id = ? AND idx = ?', note.id, idx);
  if (!page) fail(404, 'no such page');
  const b = await ctx.body();
  const text = typeof b.text === 'string' ? b.text : page.text;
  if (text.length > MAX_PAGE_CHARS) fail(400, 'the page is too long');
  const printed = b.printed === null ? null : Number.isInteger(b.printed) ? b.printed : page.printed;
  await ctx.run('UPDATE note_pages SET text = ?, hash = ?, printed = ?, confirmed = ? WHERE note_id = ? AND idx = ?',
    text, sha256Hex(text), printed, b.confirmed === false ? 0 : 1, note.id, idx);
  await markSourceChanges(ctx, note.course_id);
  return json({ ok: true });
}

export async function transcribe(ctx) {
  const { user } = await requireLecturer(ctx);
  const b = await ctx.body();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(b.media_type)) fail(400, 'send a JPEG, PNG or WebP image');
  if (typeof b.image !== 'string' || !b.image.length || b.image.length > MAX_IMAGE_B64) fail(400, 'the image must be scaled down before upload (at most about 1.2 MB)');
  await limit(ctx, `transcribe:${user.id}`, 200, 3600);
  await aiAllowance(ctx, user.id);
  const r = await ctx.services.ai.transcribe({ base64: b.image, mediaType: b.media_type });
  await recordUsage(ctx, user.id, 'transcribe', r.usage);
  return json({ text: r.text, printed: Number.isInteger(r.printedPage) ? r.printedPage : null, demo: ctx.services.ai.name === 'fake' });
}

// ---------------------------------------------------------------- selection and schedules

async function selectionText(ctx, courseId, spec) {
  const { pages } = await coursePages(ctx, courseId);
  if (!pages.length) fail(400, 'this course has no notes yet');
  const sel = resolveSelection(pages, spec);
  if (!sel.ok) fail(400, sel.error);
  const ex = extractSelection(pages, sel);
  if (!ex.text.trim()) fail(400, 'the selection is empty');
  return { ...ex, fileOf: new Map(pages.map((pg) => [pg.number, pg.fileId])) };
}

export async function preview(ctx) {
  const { course } = await courseFor(ctx, ctx.params.id);
  const { spec } = await ctx.body();
  const ex = await selectionText(ctx, course.id, spec ?? {});
  return json({ segments: ex.segments.map((s) => ({ number: s.number, text: s.text })), words: ex.text.split(/\s+/).length });
}

export async function schedule(ctx) {
  const { course, user } = await courseFor(ctx, ctx.params.id);
  const { text, duration = 15, pace = 30 } = await ctx.body();
  const { rows, format } = parseSchedule(String(text ?? ''));
  const created = [], skipped = [];
  for (const r of rows) {
    if (!r.range) { skipped.push({ label: r.label, reason: `could not read the pages "${r.pagesText}"` }); continue; }
    const id = randomId('z_');
    const selection = { kind: 'pages', from: r.range.from, to: r.range.to, fromPart: r.range.fromPart, toPart: r.range.toPart };
    const title = [course.code, r.label, r.topic].filter(Boolean).join(' · ');
    await ctx.run('INSERT INTO quizzes (id, course_id, owner_id, title, label, selection, duration, pace, count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, course.id, user.id, title, r.label, JSON.stringify(selection), duration, pace, defaultCount(duration, pace), ctx.now);
    created.push({ id, label: r.label, topic: r.topic, selection });
  }
  return json({ format, created, skipped }, 201);
}

// ---------------------------------------------------------------- generation

/** Converts a model question to the canonical shape (or returns null with a reason). */
export function canonicalFromModel(g) {
  const base = { stem: String(g.stem ?? '').trim(), explanation: g.explanation ?? '', difficulty: g.difficulty ?? 2, marks: 1 };
  if (g.type === 'tf') {
    const k = String(g.key).toLowerCase();
    if (!['true', 'false'].includes(k)) return { error: 'true/false key is not true or false' };
    return { q: { ...base, ...trueFalse(k === 'true') } };
  }
  if (g.type === 'numeric') {
    const key = parseNumber(g.key);
    if (!Number.isFinite(key)) return { error: 'numerical key is not a number' };
    return { q: { ...base, type: 'numeric', options: [], key, tolerance: { abs: Math.abs(Number(g.tolerance ?? 0)) || 0 } } };
  }
  if (g.type === 'short') return { q: { ...base, type: 'short', options: [], key: String(g.key).trim(), accepted: [] } };
  const options = makeOptions(g.options ?? []);
  const key = options.find((o) => normalizeShort(o.text) === normalizeShort(g.key))?.id ?? null;
  const q = { ...base, type: 'mcq', options, key };
  if (needsFixedOptions(options)) q.fixed_options = true;
  return { q };
}

function sameAnswer(q, answer) {
  if (q.type === 'mcq') return normalizeShort(q.options.find((o) => o.id === q.key)?.text) === normalizeShort(answer);
  if (q.type === 'tf') return String(answer).toLowerCase() === q.key;
  if (q.type === 'numeric') return Math.abs(parseNumber(answer) - q.key) <= Math.max(q.tolerance?.abs ?? 0, 1e-9 * Math.abs(q.key));
  return normalizeShort(answer) === normalizeShort(q.key);
}

const forModel = (q) => ({ type: q.type, stem: q.stem, options: q.options.map((o) => o.text) });

export async function generate(ctx) {
  const { course, user } = await courseFor(ctx, ctx.params.id);
  const b = await ctx.body();
  let spec = b.spec, quizId = null, planned = b.count;
  if (b.quiz_id) {
    const z = await ctx.one('SELECT * FROM quizzes WHERE id = ? AND course_id = ?', b.quiz_id, course.id);
    if (!z) fail(404, 'no such quiz draft');
    spec = parseJSONColumn(z.selection);
    quizId = z.id;
    planned = planned ?? z.count;
  }
  if (!spec) fail(400, 'choose the pages first');
  if (!Number.isInteger(planned) || planned < 1 || planned > 360) fail(400, 'the planned question count must be 1 to 360');
  const ex = await selectionText(ctx, course.id, spec);
  await aiAllowance(ctx, user.id);
  await limit(ctx, `generate:${user.id}`, 30, 3600);

  const pool = await ctx.all("SELECT body FROM questions WHERE course_id = ? AND status != 'retired'", course.id);
  const poolStems = pool.map((r) => parseJSONColumn(r.body, {}).stem).filter(Boolean);
  const want = Math.ceil(1.5 * planned);
  const kept = [], discarded = [];
  let cost = 0;
  const hashOf = new Map(ex.segments.map((s) => [s.number, s.hash]));

  while (kept.length < want) {
    const ask = Math.min(BATCH, want - kept.length);
    const r = await ctx.services.ai.generate({ text: ex.text, count: ask, tier: course.tier, courseTitle: course.title });
    cost += await recordUsage(ctx, user.id, 'generate', r.usage);
    let fresh = 0;
    for (const g of r.questions) {
      const c = canonicalFromModel(g);
      if (c.error) { discarded.push({ stem: g.stem, reasons: [c.error] }); continue; }
      const q = { ...c.q, source: { page: g.page, quote: g.quote } };
      const check = checkGenerated(q, ex.segments, [...poolStems, ...kept.map((k) => k.stem)]);
      if (!check.ok) { discarded.push({ stem: g.stem, reasons: check.reasons }); continue; }
      kept.push(q);
      fresh++;
    }
    if (fresh === 0 || r.questions.length < ask) break; // the text supports no more
  }

  if (kept.length) {
    const r = await ctx.services.ai.resolve({ text: ex.text, questions: kept.map(forModel) });
    cost += await recordUsage(ctx, user.id, 'resolve', r.usage);
    const byIndex = new Map(r.answers.map((a) => [a.index, a.answer]));
    kept.forEach((q, i) => { q.disputed = !byIndex.has(i) || !sameAnswer(q, byIndex.get(i)); });
  }

  const stmts = kept.map((q) => {
    const { source, disputed, ...body } = q;
    return ['INSERT INTO questions (id, owner_id, course_id, body, source, status, disputed, created_at, modified_at) VALUES (?, ?, ?, ?, ?, \'draft\', ?, ?, ?)',
      randomId('q_'), user.id, course.id, JSON.stringify(body),
      JSON.stringify({ ...source, note: ex.fileOf.get(Number(source.page)) ?? null, page_hash: hashOf.get(Number(source.page)) ?? null, quiz: quizId, generated: ctx.services.ai.model }),
      disputed ? 1 : 0, ctx.now, ctx.now];
  });
  if (stmts.length) await ctx.batch(stmts);
  return json({
    added: kept.length,
    disputed: kept.filter((q) => q.disputed).length,
    discarded,
    cost_usd: Math.round(cost * 10000) / 10000,
    fewer_than_planned: kept.length < planned,
  });
}

// ---------------------------------------------------------------- pool, assist

async function insertDrafts(ctx, user, course, questions, source, aiKey = false) {
  const stmts = questions.map((q) => {
    const { source: s, ...body } = q;
    return ['INSERT INTO questions (id, owner_id, course_id, body, source, status, ai_key, created_at, modified_at) VALUES (?, ?, ?, ?, ?, \'draft\', ?, ?, ?)',
      randomId('q_'), user.id, course.id, JSON.stringify({ marks: 1, ...body }), JSON.stringify(s ?? source), aiKey ? 1 : 0, ctx.now, ctx.now];
  });
  if (stmts.length) await ctx.batch(stmts);
  return stmts.length;
}

export async function importPool(ctx) {
  const { course, user } = await courseFor(ctx, ctx.params.id);
  const { text, filename } = await ctx.body();
  if (typeof text !== 'string' || !text.trim()) fail(400, 'paste or upload the questions first');
  if (text.length > 1_000_000) fail(413, 'that is too much text for one import');
  const r = parsePool(text, filename ?? '');
  const drafts = r.errors.filter((e) => e.draft).map((e) => e.draft);
  const added = await insertDrafts(ctx, user, course, [...r.questions, ...drafts], { import: r.format });
  return json({ format: r.format, added, complete: r.questions.length, needs_key: drafts.length, errors: r.errors.map(({ draft, ...e }) => e) }, 201);
}

export async function assist(ctx) {
  const { course, user } = await courseFor(ctx, ctx.params.id);
  const { text } = await ctx.body();
  if (typeof text !== 'string' || !text.trim()) fail(400, 'paste the questions first');
  if (text.length > 200_000) fail(413, 'send at most about 60 pages of questions at a time');
  await aiAllowance(ctx, user.id);
  await limit(ctx, `assist:${user.id}`, 30, 3600);
  const r = await ctx.services.ai.assist({ text });
  await recordUsage(ctx, user.id, 'assist', r.usage);
  const qs = [], problems = [];
  for (const g of r.questions) {
    const c = canonicalFromModel(g);
    if (c.error) problems.push({ stem: g.stem, reasons: [c.error] });
    else qs.push(c.q);
  }
  const added = await insertDrafts(ctx, user, course, qs, { import: 'ai-assist' }, true);
  return json({ added, problems }, 201);
}

// ---------------------------------------------------------------- review

function view(row) {
  const body = parseJSONColumn(row.body, {});
  return {
    id: row.id, version: row.version, status: row.status, disputed: !!row.disputed, source_changed: !!row.source_changed,
    ai_key: !!row.ai_key, body, source: parseJSONColumn(row.source, {}), problems: validateQuestion(body),
  };
}

export async function listQuestions(ctx) {
  const { course } = await courseFor(ctx, ctx.params.id);
  const status = ctx.url.searchParams.get('status');
  const quiz = ctx.url.searchParams.get('quiz');
  let rows = await ctx.all('SELECT * FROM questions WHERE course_id = ? ORDER BY disputed DESC, source_changed DESC, created_at', course.id);
  if (status) rows = rows.filter((r) => r.status === status);
  if (quiz) rows = rows.filter((r) => parseJSONColumn(r.source, {}).quiz === quiz);
  return json({ questions: rows.map(view) });
}

async function setQuestion(ctx, user, row, { body, status }) {
  let next = parseJSONColumn(row.body, {});
  let version = row.version;
  const stmts = [];
  if (body) {
    const merged = { ...next, ...body };
    const problems = validateQuestion(merged);
    if (problems.length) fail(400, problems.join('; '));
    version += 1;
    next = merged;
    stmts.push(['INSERT INTO question_versions (question_id, version, body, at, by) VALUES (?, ?, ?, ?, ?)', row.id, row.version, row.body, ctx.now, user.id]);
  }
  let newStatus = row.status;
  if (status) {
    if (!['draft', 'approved', 'retired'].includes(status)) fail(400, 'bad status');
    if (status === 'approved') {
      const problems = validateQuestion(next);
      if (problems.length) fail(400, `cannot approve: ${problems.join('; ')}`);
    }
    newStatus = status;
  }
  const approving = newStatus === 'approved';
  stmts.push(['UPDATE questions SET body = ?, version = ?, status = ?, ai_key = ?, disputed = ?, source_changed = ?, modified_at = ? WHERE id = ?',
    JSON.stringify(next), version, newStatus, approving ? 0 : row.ai_key, approving ? 0 : row.disputed, approving ? 0 : row.source_changed, ctx.now, row.id]);
  await ctx.batch(stmts);
}

export async function updateQuestion(ctx) {
  const row = await ctx.one('SELECT * FROM questions WHERE id = ?', ctx.params.id);
  if (!row) fail(404, 'no such question');
  const { user } = await courseFor(ctx, row.course_id);
  await setQuestion(ctx, user, row, await ctx.body());
  return json(view(await ctx.one('SELECT * FROM questions WHERE id = ?', row.id)));
}

export async function bulk(ctx) {
  const { course, user } = await courseFor(ctx, ctx.params.id);
  const { ids, action, confirm } = await ctx.body();
  if (confirm !== true) fail(400, 'a bulk change needs an explicit confirmation');
  if (!['approve', 'retire'].includes(action)) fail(400, 'action must be approve or retire');
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000) fail(400, 'choose 1 to 1000 questions');
  const done = [], refused = [];
  for (const id of ids) {
    const row = await ctx.one('SELECT * FROM questions WHERE id = ? AND course_id = ?', id, course.id);
    if (!row) { refused.push({ id, reason: 'not in this course' }); continue; }
    try {
      await setQuestion(ctx, user, row, { status: action === 'approve' ? 'approved' : 'retired' });
      done.push(id);
    } catch (e) {
      refused.push({ id, reason: e.message });
    }
  }
  await ctx.audit(user.id, `questions.bulk.${action}`, course.id, { done: done.length, refused: refused.length });
  return json({ done, refused });
}
