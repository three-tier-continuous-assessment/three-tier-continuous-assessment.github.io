// Integration tests: the request handler end to end on node:sqlite with fakes and a test clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeApp } from '../tools/node-app.mjs';
import { fakeGoogleToken } from '../worker/src/services/google.mjs';
import { fakeAI } from '../worker/src/services/ai.mjs';
import { prepareSitting, optionOrder, LETTERS } from '../shared/order.mjs';

// FIXTURE: synthetic lecture notes, not teaching content.
const SENTENCES = [
  'A thermodynamic system is the quantity of matter or region of space chosen for careful study.',
  'Everything outside the system boundary is called the surroundings, and energy may cross between them.',
  'A closed system exchanges energy with its surroundings but never exchanges mass across the boundary.',
  'An isolated system exchanges neither energy nor mass, so its total energy remains constant forever.',
  'Intensive properties such as pressure and temperature do not depend on the extent of the system.',
  'Extensive properties such as volume and internal energy scale directly with the amount of matter.',
  'The zeroth law states that two bodies in thermal equilibrium with a third are in equilibrium together.',
  'Temperature scales are established by assigning numerical values to reproducible fixed reference states.',
  'Work is energy transferred when a force acts through a displacement on the system boundary.',
  'Boundary work requires a moving boundary, as when a piston compresses gas inside a cylinder.',
  'Heat transfer is energy crossing the boundary solely because of a temperature difference between regions.',
  'Adiabatic processes involve no heat transfer, although work interactions may still change internal energy.',
  'The first law expresses conservation of energy for every process that a closed system undergoes.',
  'Internal energy is a property, whereas heat and work are path functions that depend on the process.',
  'Specific heat measures the energy required to raise the temperature of unit mass by one degree.',
  'Enthalpy combines internal energy with the product of pressure and volume for convenient flow analysis.',
  'Steady flow devices such as turbines and compressors operate with properties constant over time.',
  'Nozzles accelerate fluids by converting enthalpy into kinetic energy along the direction of flow.',
  'Throttling valves reduce pressure significantly while keeping enthalpy approximately constant during flow.',
  'Heat exchangers transfer thermal energy between two moving fluids that remain physically separated.',
  'The second law establishes that heat flows spontaneously from hotter regions toward colder regions.',
  'Thermal efficiency compares the useful work output of an engine with the heat energy supplied.',
  'Reversible processes are idealizations that set upper limits on the performance of real devices.',
  'Irreversibilities such as friction and unrestrained expansion reduce the useful work obtainable.',
  'Entropy is a property that quantifies the dispersal of energy within a thermodynamic system.',
  'The Carnot cycle consists of two isothermal processes and two adiabatic processes performed reversibly.',
  'Refrigerators transfer heat from cold spaces to warmer surroundings by consuming external work.',
  'The coefficient of performance expresses refrigeration effect divided by the work input required.',
  'Ideal gases obey an equation of state relating pressure, volume, temperature and the gas constant.',
  'Compressibility factors correct ideal gas predictions for real gases near saturation conditions.',
];
const page = (i) => `# Section ${i + 1}\n\n${SENTENCES.slice(i * 5, i * 5 + 5).join(' ')}`;

const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);

function harness(options = {}) {
  const clock = { now: T0 };
  const h = nodeApp({ clock: () => clock.now, adminEmails: 'admin@unn.edu.ng', ...options });
  const seen = [];
  async function call(method, path, body, token, { raw, headers = {} } = {}) {
    const res = await h.app(new Request(`http://local${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }));
    const text = await res.text();
    const out = { status: res.status, body: text ? JSON.parse(text) : null, text };
    if (/^\/api\/(q\/|attempt\/)/.test(path)) seen.push(text);
    return out;
  }
  const signIn = async (claims) => (await call('POST', '/api/auth/google', { id_token: fakeGoogleToken(claims) })).body;
  return { ...h, clock, call, signIn, seen };
}

async function lecturerWithQuiz(h, { questions = 20, duration = 15, pace = 45, rosterCSV, codes = true } = {}) {
  const lec = await h.signIn({ sub: 'lec-1', email: 'ada.obi@unn.edu.ng', name: 'Ada Obi', hd: 'unn.edu.ng' });
  const L = lec.token;
  const course = await h.call('POST', '/api/courses', { title: 'Engineering Thermodynamics', code: 'MEE 999', tier: 'tertiary', institution: 'Fixture University' }, L);
  const cid = course.body.id;
  await h.call('POST', `/api/courses/${cid}/notes`, { name: 'Lecture 1', kind: 'pdf', first_page: 1, rights: true, pages: [0, 1, 2].map((i) => ({ text: page(i) })) }, L);
  await h.call('POST', `/api/courses/${cid}/notes`, { name: 'Lecture 2', kind: 'pdf', first_page: 4, rights: true, pages: [3, 4, 5].map((i) => ({ text: page(i) })) }, L);
  const sch = await h.call('POST', `/api/courses/${cid}/schedule`, { text: 'CA,Pages,Topic\nCA1,1-6,Foundations of thermodynamics\n', duration, pace }, L);
  const qid = sch.body.created[0].id;
  const gen = await h.call('POST', `/api/courses/${cid}/generate`, { quiz_id: qid, count: questions }, L);
  const list = await h.call('GET', `/api/courses/${cid}/questions?quiz=${qid}`, undefined, L);
  await h.call('POST', `/api/courses/${cid}/questions/bulk`, { ids: list.body.questions.map((q) => q.id), action: 'approve', confirm: true }, L);
  await h.call('PUT', `/api/quizzes/${qid}`, { count: questions }, L);
  const roster = await h.call('POST', `/api/quizzes/${qid}/roster`, {
    csv: rosterCSV ?? 'Reg No,Name,Email\n2019/100001,Chidi Eze,\n2019/100002,Ngozi Okafor,ngozi@example.com\n2019/100003,Emeka Nwosu,\n2019/100004,Amaka Ibe,\n',
    codes,
  }, L);
  return { L, cid, qid, gen: gen.body, roster: roster.body };
}

/** The display letter of the correct option for (attempt, slot): computed from the server's records. */
async function correctLetter(h, attemptId, slot) {
  const a = await h.db.prepare('SELECT * FROM attempts WHERE id = ?').bind(attemptId).first();
  const z = await h.db.prepare('SELECT * FROM quizzes WHERE id = ?').bind(a.quiz_id).first();
  const qid = JSON.parse(a.question_order)[slot - 1];
  const q = JSON.parse((await h.db.prepare('SELECT body FROM quiz_questions WHERE quiz_id = ? AND question_id = ?').bind(z.id, qid).first()).body);
  const order = optionOrder(z.secret, a.seat, qid, q.options.map((o) => o.id), { fixed: !!q.fixed_options });
  return { correct: LETTERS[order.indexOf(q.key)], wrong: LETTERS[order.findIndex((id) => id !== q.key)] };
}

test('Level 1: staff addresses on Google Workspace pass; student, personal and unmanaged addresses do not', async () => {
  const h = harness();
  const ok = await h.signIn({ sub: 's1', email: 'firstname.lastname@unn.edu.ng', name: 'First Last', hd: 'unn.edu.ng' });
  assert.equal(ok.tier, 'verified');
  const student = await h.signIn({ sub: 's2', email: '2019123456@unn.edu.ng', name: 'A Student', hd: 'unn.edu.ng' });
  assert.equal(student.tier, 'none');
  assert.match(student.level1_reason, /registration number/);
  const noHd = await h.signIn({ sub: 's3', email: 'x.y@unn.edu.ng', name: 'X Y' });
  assert.equal(noHd.tier, 'none');
  assert.match(noHd.level1_reason, /institution's Google account/);
  const personal = await h.signIn({ sub: 's4', email: 'someone@gmail.com', name: 'S' });
  assert.match(personal.level1_reason, /personal addresses/);
  const blocked = await h.call('POST', '/api/courses', { title: 'T', tier: 'tertiary' }, student.token);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.needs, 'level1');
});

test('notes to published quiz: schedule, generation with grounding, review, roster, publication rules', async () => {
  const h = harness();
  const { L, cid, qid, gen, roster } = await lecturerWithQuiz(h);
  assert.ok(gen.added >= 20, `added ${gen.added}`);
  assert.equal(gen.disputed, 0);
  assert.equal(roster.rows, 4);
  assert.equal(roster.codes.length, 4);
  const preview = await h.call('POST', `/api/courses/${cid}/preview`, { spec: { kind: 'pages', from: 3, to: 4 } }, L);
  assert.deepEqual(preview.body.segments.map((s) => s.number), [3, 4]); // Lecture 2 continues the numbering
  const pub = await h.call('POST', `/api/quizzes/${qid}/publish`, {}, L);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.match(pub.body.code, /^[0-9A-Z]{6}$/);
  assert.equal(pub.body.capacity, 4 + 10);
  const again = await h.call('POST', `/api/quizzes/${qid}/publish`, {}, L);
  assert.equal(again.status, 409);
});

test('generation discards fabricated quotes and flags disputed keys', async () => {
  const lying = {
    ...fakeAI(),
    async generate(args) {
      const r = await fakeAI().generate(args);
      r.questions[0].quote = 'a sentence that does not appear anywhere in these notes';
      return r;
    },
  };
  const h = harness({ ai: { ...lying, resolve: fakeAI({ disagreeEvery: 4 }).resolve } });
  const { gen } = await lecturerWithQuiz(h, { questions: 8 });
  assert.ok(gen.discarded.some((d) => d.reasons.some((r) => /does not appear/.test(r))));
  assert.ok(gen.disputed >= 1);
});

test('publication refuses too few approved questions and an open sitting without Gold', async () => {
  const h = harness();
  const { L, qid, cid } = await lecturerWithQuiz(h, { questions: 20 });
  const qs = await h.call('GET', `/api/courses/${cid}/questions?quiz=${qid}`, undefined, L);
  for (const q of qs.body.questions.slice(0, qs.body.questions.length - 10)) await h.call('PUT', `/api/questions/${q.id}`, { status: 'retired' }, L);
  const pub = await h.call('POST', `/api/quizzes/${qid}/publish`, {}, L);
  assert.equal(pub.status, 409);
  assert.match(pub.body.error, /only 10 approved/);
  const open = await h.call('POST', '/api/quizzes', { course_id: cid, title: 'Open', duration: 15, pace: 45, count: 20, open_sitting: true }, L);
  assert.equal(open.status, 403);
  assert.equal(open.body.needs, 'gold');
  const noConfirm = await h.call('POST', `/api/courses/${cid}/questions/bulk`, { ids: [qs.body.questions[0].id], action: 'approve' }, L);
  assert.equal(noConfirm.status, 400);
});

test('sitting: check-in, gated slots, timing windows, grading, paywall and payment', async () => {
  const h = harness();
  const { L, qid, roster } = await lecturerWithQuiz(h, { questions: 20 });
  await h.call('PUT', `/api/quizzes/${qid}`, { opens_at: T0 + 60_000 }, L);
  const { code } = (await h.call('POST', `/api/quizzes/${qid}/publish`, {}, L)).body;
  await h.call('PUT', `/api/quizzes/${qid}`, { opens_at: T0 + 60_000 }, L);

  const card = await h.call('GET', `/api/q/${code}`);
  assert.equal(card.body.count, 20);
  const ci = await h.call('POST', `/api/q/${code}/checkin`, { via: 'code', code: roster.codes[0].code });
  assert.equal(ci.status, 200, ci.text);
  assert.equal(ci.body.candidate.reg_no, '2019/100001');
  const A = ci.body.token;
  const attemptId = JSON.parse(atob(A.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).aid;

  const early = await h.call('POST', '/api/attempt/start', {}, A);
  assert.equal(early.status, 425);
  h.clock.now = T0 + 60_000;
  const st = await h.call('POST', '/api/attempt/start', {}, A);
  assert.equal(st.status, 200);
  const t0 = st.body.t0;

  const s1 = await h.call('GET', '/api/attempt/slot', undefined, A);
  assert.equal(s1.body.slot, 1);
  assert.equal(s1.body.question.options.length, 4);
  assert.deepEqual(Object.keys(s1.body.question.options[0]).sort(), ['letter', 'text']);
  const k1 = await correctLetter(h, attemptId, 1);
  assert.equal((await h.call('POST', '/api/attempt/answer', { slot: 1, choice: k1.correct }, A)).status, 200);
  h.clock.now = t0 + 45_000 + 3_000; // the last instant of slot 1's grace
  assert.equal((await h.call('POST', '/api/attempt/answer', { slot: 1, choice: k1.correct }, A)).status, 200);
  h.clock.now = t0 + 45_000 + 3_001;
  const late = await h.call('POST', '/api/attempt/answer', { slot: 1, choice: k1.wrong }, A);
  assert.equal(late.status, 409);
  assert.equal(late.body.late, true);
  const notYet = await h.call('POST', '/api/attempt/answer', { slot: 3, choice: 'A' }, A);
  assert.equal(notYet.status, 409);
  const k2 = await correctLetter(h, attemptId, 2);
  assert.equal((await h.call('POST', '/api/attempt/answer', { slot: 2, choice: k2.wrong }, A)).status, 200);
  const s2 = await h.call('GET', '/api/attempt/slot', undefined, A);
  assert.equal(s2.body.slot, 2);
  assert.equal(s2.body.answered, k2.wrong); // restored after a refresh

  const running = await h.call('GET', '/api/attempt/result', undefined, A);
  assert.equal(running.status, 409);
  h.clock.now = t0 + 20 * 45_000 + 3_000;
  const done = await h.call('GET', '/api/attempt/slot', undefined, A);
  assert.equal(done.body.finished, true);

  const locked = await h.call('GET', '/api/attempt/result', undefined, A);
  assert.equal(locked.status, 402);
  assert.equal(locked.body.price, 100);
  assert.equal(locked.body.currency, 'NGN');
  const pay = await h.call('POST', '/api/pay/init', { product: 'student_result', email: 'parent@example.com' }, A);
  assert.equal(pay.status, 200, pay.text);
  assert.equal(pay.body.amount, 100);
  const ref = pay.body.reference;
  assert.equal((await h.call('POST', '/api/pay/verify', { reference: ref })).body.status, 'pending'); // not paid yet
  assert.equal((await h.call('POST', '/api/pay/test-complete', { reference: ref })).body.status, 'success');
  const result = await h.call('GET', '/api/attempt/result', undefined, A);
  assert.equal(result.status, 200);
  assert.deepEqual([result.body.score, result.body.max, result.body.attempted, result.body.correct, result.body.wrong, result.body.unanswered], [1, 20, 2, 1, 1, 18]);
  assert.match(result.body.result_id, /^r_/);
  const twice = await h.call('POST', '/api/pay/init', { product: 'student_result', email: 'parent@example.com' }, A);
  assert.equal(twice.body.entitled, true); // never charged twice
  const verified = await h.call('GET', `/api/results/${result.body.result_id}`);
  assert.equal(verified.body.initials, 'C. E.');
  assert.equal(verified.body.score, 1);

  for (const text of h.seen) {
    for (const leak of ['"key"', '"explanation"', '"secret"', '"source"', '"question_order"', '"quote"']) {
      assert.ok(!text.includes(leak), `candidate response leaks ${leak}: ${text.slice(0, 200)}`);
    }
  }
});

test('identity at check-in: roster email, claimed reg numbers, unlisted candidates, device switch', async () => {
  const h = harness();
  const { L, qid, roster } = await lecturerWithQuiz(h);
  const { code } = (await h.call('POST', `/api/quizzes/${qid}/publish`, {}, L)).body;
  const g = (sub, email, name, extra = {}) => ({ via: 'google', id_token: fakeGoogleToken({ sub, email, name }), ...extra });

  const wrongEmail = await h.call('POST', `/api/q/${code}/checkin`, g('x', 'impostor@example.com', 'Imp', { reg_no: '2019/100002' }));
  assert.equal(wrongEmail.status, 403);
  const right = await h.call('POST', `/api/q/${code}/checkin`, g('ngozi', 'ngozi@example.com', 'Ngozi Okafor', { reg_no: '2019/100002' }));
  assert.equal(right.status, 200);
  const first = await h.call('POST', `/api/q/${code}/checkin`, g('chidi', 'chidi@example.com', 'Chidi Eze', { reg_no: '2019/100001' }));
  assert.equal(first.status, 200);
  const claimed = await h.call('POST', `/api/q/${code}/checkin`, g('other', 'other@example.com', 'Other', { reg_no: '2019/100001' }));
  assert.equal(claimed.status, 403);
  assert.match(claimed.body.error, /already been claimed/);
  const late = await h.call('POST', `/api/q/${code}/checkin`, g('late', 'late@example.com', 'Late Comer', { reg_no: '2019/100099' }));
  assert.equal(late.status, 200);
  assert.equal(late.body.candidate.listed, false);
  const status = await h.call('GET', `/api/quizzes/${qid}/status`, undefined, L);
  assert.equal(status.body.unlisted, 1);

  const one = await h.call('POST', `/api/q/${code}/checkin`, { via: 'code', code: roster.codes[2].code });
  const two = await h.call('POST', `/api/q/${code}/checkin`, { via: 'code', code: roster.codes[2].code.toLowerCase() });
  assert.equal(two.status, 200);
  const replaced = await h.call('POST', '/api/attempt/start', {}, one.body.token);
  assert.equal(replaced.status, 409);
  assert.equal(replaced.body.replaced, true);
  assert.equal((await h.call('POST', '/api/attempt/start', {}, two.body.token)).status, 200);
});

test('payments: wrong amount, webhook signatures and replays, lazy settlement, class report', async () => {
  const h = harness();
  const { L, qid, roster } = await lecturerWithQuiz(h);
  const { code } = (await h.call('POST', `/api/quizzes/${qid}/publish`, {}, L)).body;
  const tokens = [];
  for (const r of roster.codes.slice(0, 3)) {
    const ci = await h.call('POST', `/api/q/${code}/checkin`, { via: 'code', code: r.code });
    await h.call('POST', '/api/attempt/start', {}, ci.body.token);
    tokens.push(ci.body.token);
  }
  h.clock.now += 20 * 45_000 + 4_000;
  for (const t of tokens) assert.equal((await h.call('GET', '/api/attempt/result', undefined, t)).status, 402);

  // A payment of the wrong amount never unlocks.
  const p1 = await h.call('POST', '/api/pay/init', { product: 'student_result', email: 'a@example.com' }, tokens[0]);
  h.services.paystack.complete(p1.body.reference, { amountKobo: 5000 });
  assert.equal((await h.call('POST', '/api/pay/verify', { reference: p1.body.reference })).body.status, 'mismatch');
  assert.equal((await h.call('GET', '/api/attempt/result', undefined, tokens[0])).status, 402);

  // Lazy settlement: paid at Paystack, no verify call and no webhook, unlocked on the next request.
  const p2 = await h.call('POST', '/api/pay/init', { product: 'student_result', email: 'b@example.com' }, tokens[1]);
  h.services.paystack.complete(p2.body.reference);
  assert.equal((await h.call('GET', '/api/attempt/result', undefined, tokens[1])).status, 200);

  // Webhook: a bad signature is refused; a good one settles; a replay changes nothing.
  const p3 = await h.call('POST', '/api/pay/init', { product: 'student_result', email: 'c@example.com' }, tokens[2]);
  h.services.paystack.complete(p3.body.reference);
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: p3.body.reference } });
  const bad = await h.call('POST', '/api/pay/webhook', undefined, null, { raw, headers: { 'x-paystack-signature': 'deadbeef' } });
  assert.equal(bad.status, 401);
  const sig = await h.services.paystack.sign(raw);
  for (let i = 0; i < 2; i++) {
    const ok = await h.call('POST', '/api/pay/webhook', undefined, null, { raw, headers: { 'x-paystack-signature': sig } });
    assert.equal(ok.status, 200);
  }
  const ents = await h.db.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE reference = ?').bind(p3.body.reference).first();
  assert.equal(ents.n, 1);

  // The class report: locked, then paid, then free to download again.
  assert.equal((await h.call('GET', `/api/quizzes/${qid}/report`, undefined, L)).status, 402);
  const pr = await h.call('POST', '/api/pay/init', { product: 'class_report', quiz_id: qid }, L);
  assert.equal(pr.body.amount, 500);
  await h.call('POST', '/api/pay/test-complete', { reference: pr.body.reference });
  const rep = await h.call('GET', `/api/quizzes/${qid}/report`, undefined, L);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.rows.length, 4);
  assert.equal(rep.body.rows.filter((r) => r.status === 'absent').length, 1);
  assert.equal(rep.body.stats.submissions, 3);
  assert.equal(rep.body.items.length, 20);
  assert.equal((await h.call('POST', '/api/pay/init', { product: 'class_report', quiz_id: qid }, L)).body.entitled, true);

  // Bulk unlock is charged per candidate still locked: here only the one whose payment was short.
  const finished = rep.body.rows.filter((r) => r.status === 'finished').map((r) => r.attempt_id);
  const bulk = await h.call('POST', '/api/pay/init', { product: 'bulk_unlock', quiz_id: qid, attempt_ids: finished }, L);
  assert.equal(bulk.status, 200, bulk.text);
  assert.equal(bulk.body.amount, 100);
  await h.call('POST', '/api/pay/test-complete', { reference: bulk.body.reference });
  assert.equal((await h.call('GET', '/api/attempt/result', undefined, tokens[0])).status, 200);
});

test('Gold Certified: Level 2 by challenge code and admin check; Level 3 by NIN; open sittings', async () => {
  const NIN = '12345678901';
  const h = harness({ ninRecords: { [NIN]: { firstName: 'Ada', middleName: 'Ngozi', lastName: 'Obi', dob: '1980-01-31' } } });
  const lec = await h.signIn({ sub: 'lec-1', email: 'ada.obi@unn.edu.ng', name: 'Ada Obi', hd: 'unn.edu.ng' });
  const L = lec.token;
  assert.equal(lec.tier, 'verified');

  const start = await h.call('POST', '/api/verify/research', { method: 'orcid', identifier: '0000-0002-1825-0097' }, L);
  assert.match(start.body.code, /^GCAES-[0-9A-Z]{5}$/);
  await h.call('POST', `/api/verify/research/${start.body.id}/submit`, {}, L);
  const admin = await h.signIn({ sub: 'adm', email: 'admin@unn.edu.ng', name: 'Admin', hd: 'unn.edu.ng' });
  const queue = await h.call('GET', '/api/admin/verifications', undefined, admin.token);
  assert.equal(queue.body.items.length, 1);
  const wrongCode = await h.call('POST', `/api/admin/verifications/${start.body.id}`, { decision: 'pass', observed_code: 'GCAES-00000' }, admin.token);
  assert.equal(wrongCode.status, 400);
  const pass = await h.call('POST', `/api/admin/verifications/${start.body.id}`, { decision: 'pass', observed_code: start.body.code.toLowerCase() }, admin.token);
  assert.equal(pass.body.status, 'passed');
  assert.equal((await h.call('GET', '/api/me', undefined, L)).body.tier, 'gold');

  // Level 3 for a second lecturer, with the NIN never stored.
  const lec2 = await h.signIn({ sub: 'lec-2', email: 'adaeze.obi@unilag.edu.ng', name: 'Adaeze Obi', hd: 'unilag.edu.ng' });
  const badDob = await h.call('POST', '/api/verify/nin', { nin: NIN, dob: '1981-01-31', consent: true }, lec2.token);
  assert.equal(badDob.body.status, 'failed');
  const noConsent = await h.call('POST', '/api/verify/nin', { nin: NIN, dob: '1980-01-31' }, lec2.token);
  assert.equal(noConsent.status, 400);
  const ok = await h.call('POST', '/api/verify/nin', { nin: NIN, dob: '1980-01-31', consent: true }, lec2.token);
  assert.equal(ok.body.status, 'passed');
  assert.equal((await h.call('GET', '/api/me', undefined, lec2.token)).body.tier, 'gold');
  const lec3 = await h.signIn({ sub: 'lec-3', email: 'someone@unn.edu.ng', name: 'Some One', hd: 'unn.edu.ng' });
  const dup = await h.call('POST', '/api/verify/nin', { nin: NIN, dob: '1980-01-31', consent: true }, lec3.token);
  assert.equal(dup.status, 409);
  const dump = [];
  for (const t of ['verifications', 'audit_log', 'users', 'rate_limits']) dump.push(JSON.stringify(await h.db.prepare(`SELECT * FROM ${t}`).all()));
  assert.ok(!dump.join('').includes(NIN), 'the NIN must never be stored');

  // A Gold lecturer may run an open sitting; 300 parallel check-ins get 300 distinct seats.
  const course = await h.call('POST', '/api/courses', { title: 'Open course', tier: 'tertiary' }, L);
  const cid = course.body.id;
  await h.call('POST', `/api/courses/${cid}/notes`, { name: 'N', kind: 'pdf', rights: true, pages: [0, 1, 2, 3, 4, 5].map((i) => ({ text: page(i) })) }, L);
  const z = await h.call('POST', '/api/quizzes', { course_id: cid, title: 'Open quiz', duration: 15, pace: 45, count: 20, open_sitting: true, selection: { kind: 'pages', from: 1, to: 6 } }, L);
  assert.equal(z.status, 201, z.text);
  await h.call('POST', `/api/courses/${cid}/generate`, { quiz_id: z.body.id, count: 20 }, L);
  const list = await h.call('GET', `/api/courses/${cid}/questions?quiz=${z.body.id}`, undefined, L);
  await h.call('POST', `/api/courses/${cid}/questions/bulk`, { ids: list.body.questions.map((q) => q.id), action: 'approve', confirm: true }, L);
  const pub = await h.call('POST', `/api/quizzes/${z.body.id}/publish`, {}, L);
  assert.equal(pub.status, 200, pub.text);
  const many = await Promise.all(Array.from({ length: 300 }, (_, i) => h.call('POST', `/api/q/${pub.body.code}/checkin`, {
    via: 'google', id_token: fakeGoogleToken({ sub: `cand-${i}`, email: `cand${i}@example.com`, name: `Candidate ${i}` }), name: `Candidate ${i}`,
  })));
  assert.ok(many.every((r) => r.status === 200), many.find((r) => r.status !== 200)?.text);
  const seats = await h.db.prepare('SELECT COUNT(DISTINCT seat) AS n, COUNT(*) AS total FROM attempts WHERE quiz_id = ?').bind(z.body.id).first();
  assert.deepEqual([seats.n, seats.total], [300, 300]);
  const orders = await h.db.prepare('SELECT COUNT(DISTINCT question_order) AS n FROM attempts WHERE quiz_id = ?').bind(z.body.id).first();
  assert.equal(orders.n, 300);
  const same = await Promise.all([0, 1].map(() => h.call('POST', `/api/q/${pub.body.code}/checkin`, {
    via: 'google', id_token: fakeGoogleToken({ sub: 'twice', email: 'twice@example.com', name: 'Twice' }), name: 'Twice',
  })));
  assert.ok(same.every((r) => r.status === 200));
  const twice = await h.db.prepare("SELECT COUNT(*) AS n FROM roster WHERE quiz_id = ? AND bound_sub = 'twice'").bind(z.body.id).first();
  assert.equal(twice.n, 1);
});

test('void and reset attempts; a voided result is free and final', async () => {
  const h = harness();
  const { L, qid, roster } = await lecturerWithQuiz(h);
  const { code } = (await h.call('POST', `/api/quizzes/${qid}/publish`, {}, L)).body;
  const ci = await h.call('POST', `/api/q/${code}/checkin`, { via: 'code', code: roster.codes[0].code });
  await h.call('POST', '/api/attempt/start', {}, ci.body.token);
  const aid = JSON.parse(atob(ci.body.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).aid;
  assert.equal((await h.call('POST', `/api/attempts/${aid}/reset`, {}, L)).status, 400); // a reason is required
  assert.equal((await h.call('POST', `/api/attempts/${aid}/reset`, { reason: 'phone battery died' }, L)).status, 200);
  const again = await h.call('POST', '/api/attempt/start', {}, ci.body.token);
  assert.equal(again.body.status, 'started');
  assert.equal((await h.call('POST', `/api/attempts/${aid}/void`, { reason: 'phone in the hall' }, L)).status, 200);
  const res = await h.call('GET', '/api/attempt/result', undefined, ci.body.token);
  assert.equal(res.body.void, true);
  assert.equal(res.body.reason, 'phone in the hall');
});
