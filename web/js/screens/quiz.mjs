// A candidate's quiz (brief §4, §7.2): card, check-in, waiting room, one timed question at a time,
// then the result. The clock is the server's: the page measures the offset once and then follows
// a monotonic clock, so changing the phone's time changes nothing.

import { h, field, note, fmtSecs, fmtDate, fmtDay, naira, toast } from '../dom.mjs';
import { api, attempt, store } from '../api.mjs';
import { rich } from '../render.mjs';
import { googleSignIn } from '../signin.mjs';

export default async function quiz(root, codeRaw) {
  const code = codeRaw.toUpperCase();
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  const card = await api('GET', `/api/q/${code}`);
  if (card.status !== 200) {
    root.append(h('h1', { text: 'Quiz not found' }), note(card.data.error ?? 'Check the code and try again.', 'bad'), h('a', { href: '#/', text: 'Back' }));
    return stop;
  }
  const q = card.data;
  const head = h('div', { class: 'card' },
    h('h1', { text: q.title }),
    h('p', { class: 'muted' }, [q.course?.code, q.course?.title, q.course?.institution].filter(Boolean).join(' · ')),
    h('p', {}, `${q.count} questions · ${q.pace} seconds each · about ${Math.round(q.length_seconds / 60)} minutes`),
    q.lecturer ? h('p', { class: 'small' }, 'Set by ', h('strong', { text: q.lecturer }), q.gold ? h('span', {}, ' ', h('span', { class: 'badge gold', text: 'Gold Certified lecturer' })) : null) : null,
    q.opens_at ? h('p', { class: 'small muted', text: `Opens ${fmtDate(q.opens_at)}${q.last_start ? ` · last start ${fmtDate(q.last_start)}` : ''}` }) : null,
  );
  const body = h('div');
  root.append(head, body);

  const saved = attempt.get(code);
  if (saved?.token) await resume(saved);
  else checkinView();
  return stop;

  // ------------------------------------------------------------ check-in

  function checkinView(message) {
    stop();
    body.replaceChildren();
    if (message) body.append(note(message, 'warn'));
    if (q.status !== 'published') { body.append(note('This quiz is closed.', 'bad')); return; }
    const done = async (r) => {
      if (r.status !== 200) { toast(r.data.error ?? 'Check-in failed'); return; }
      attempt.save(code, { token: r.data.token, candidate: r.data.candidate });
      confirmView(r.data.candidate);
    };
    if (q.roster) {
      const c = h('input', { autocapitalize: 'characters', autocomplete: 'one-time-code', spellcheck: 'false', placeholder: '8 characters' });
      body.append(h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        done(await api('POST', `/api/q/${code}/checkin`, { via: 'code', code: c.value }));
      } }, h('h2', { text: 'I have a code' }), field('Your candidate code', c), h('div', { style: { marginTop: '12px' } }, h('button', { class: 'primary', type: 'submit', text: 'Check in' }))));
    }
    const reg = h('input', { autocomplete: 'off', placeholder: q.open_sitting ? 'optional' : 'e.g. 2019/123456' });
    const name = h('input', { autocomplete: 'name' });
    const g = h('div');
    body.append(h('div', { class: 'card' },
      h('h2', { text: q.roster ? 'Or check in with Google' : 'Check in with Google' }),
      field(q.open_sitting ? 'Registration number (optional)' : 'Your registration number', reg),
      q.open_sitting ? field('Your full name', name) : null,
      h('p', { class: 'small muted', text: 'Then sign in with your Google account.' }),
      g));
    googleSignIn(g, { title: 'Check in with Google', onToken: async (idToken) => {
      if (!q.open_sitting && !reg.value.trim()) { toast('Enter your registration number first'); reg.focus(); return; }
      done(await api('POST', `/api/q/${code}/checkin`, { via: 'google', id_token: idToken, reg_no: reg.value.trim(), name: name.value.trim() || undefined }));
    } });
  }

  function confirmView(c) {
    body.replaceChildren(h('div', { class: 'card' },
      h('h2', { text: 'Is this you?' }),
      h('p', { class: 'stem' }, h('strong', { text: c.name ?? '(no name on the roster)' })),
      h('p', { text: `Registration number: ${c.reg_no ?? '—'}` }),
      c.listed === false ? note('You are not on the class list. You can sit the quiz; the lecturer will confirm you afterwards.', 'warn') : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => readyView(), text: 'Yes, continue' }),
        h('button', { onclick: () => { attempt.clear(code); checkinView('Checked out. Check in again with your own details.'); }, text: 'No, this is not me' }))));
  }

  async function resume(saved) {
    const r = await api('GET', '/api/attempt/slot', undefined, saved.token);
    if (r.status === 401 || r.data.replaced) { attempt.clear(code); checkinView(r.data.replaced ? 'This quiz was opened on another device. Check in again to continue here.' : undefined); return; }
    if (r.data.needs_start) { readyView(r.data.server_now); return; }
    if (r.data.void) { voidView(r.data.reason); return; }
    if (r.data.finished) { resultView(); return; }
    if (r.status === 200) { running(saved.token, r.data); return; }
    if (r.offline) { body.replaceChildren(note(r.data.error, 'bad'), h('button', { onclick: () => resume(saved), text: 'Try again' })); return; }
    checkinView(r.data.error);
  }

  // ------------------------------------------------------------ waiting room

  function readyView(serverNow = q.server_now) {
    stop();
    const token = attempt.get(code)?.token;
    const offset = serverNow - Date.now();
    const now = () => Date.now() + offset;
    const start = h('button', { class: 'primary', text: 'Start the quiz' });
    const wait = h('div', { class: 'countdown', 'aria-live': 'polite' });
    body.replaceChildren(h('div', { class: 'card' },
      h('h2', { text: 'Before you start' }),
      h('ul', {},
        h('li', { text: `There are ${q.count} questions. Each one is shown for ${q.pace} seconds, then the next appears.` }),
        h('li', { text: 'Tap an answer and it is saved at once. You may change it until that question\'s time ends.' }),
        h('li', { text: 'Answering early does not skip ahead. If you lose your connection, the clock keeps running.' }),
        h('li', { text: 'Keep this page open. If you must reload, you will return to the current question.' })),
      wait, start));
    const tick = () => {
      if (q.opens_at && now() < q.opens_at) {
        start.disabled = true;
        wait.textContent = `Opens in ${fmtSecs((q.opens_at - now()) / 1000)}`;
      } else {
        start.disabled = false;
        wait.textContent = '';
      }
    };
    tick();
    timer = setInterval(tick, 500);
    start.onclick = async () => {
      start.disabled = true;
      const r = await api('POST', '/api/attempt/start', {}, token);
      if (r.status === 200) {
        const s = await api('GET', '/api/attempt/slot', undefined, token);
        if (s.data.finished) resultView();
        else running(token, s.data);
      } else {
        toast(r.data.error ?? 'Could not start');
        start.disabled = false;
      }
    };
  }

  // ------------------------------------------------------------ running

  function running(token, first) {
    stop();
    let offset = first.server_now - performance.now();
    const serverNow = () => performance.now() + offset;
    let slot = first;
    let pending = null; // { slot, choice } not yet saved
    const qn = h('strong');
    const total = h('span', { class: 'small' });
    const left = h('span', { class: 'small', 'aria-live': 'off' });
    const conn = h('span', { class: 'small' });
    const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'time left for this question' }, h('div'));
    const stem = h('div', { class: 'stem', 'aria-live': 'polite' });
    const opts = h('div', { class: 'options' });
    const status = h('div', { class: 'saved', 'aria-live': 'polite' });
    body.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'quizbar' }, qn, left), bar,
      h('div', { class: 'quizbar' }, total, conn),
      stem, opts, status));

    async function save(k, choice) {
      pending = { slot: k, choice };
      status.textContent = 'Saving…';
      const r = await api('POST', '/api/attempt/answer', { slot: k, choice }, token);
      if (r.status === 200) {
        if (pending?.slot === k && pending.choice === choice) pending = null;
        offset = r.data.server_now - performance.now();
        if (k === slot.slot) status.textContent = 'Saved ✓';
        conn.textContent = '';
      } else if (r.offline) {
        conn.textContent = 'No connection';
        conn.className = 'small conn-off';
        status.textContent = 'Not saved yet. Retrying…';
      } else {
        if (pending?.slot === k) pending = null;
        status.textContent = r.data.late ? 'Too late: that answer was not recorded.' : r.data.error ?? 'Not saved.';
        if (r.data.replaced) { stop(); attempt.clear(code); checkinView('This quiz was opened on another device.'); }
      }
    }

    async function show(s) {
      slot = s;
      qn.textContent = `Question ${s.slot} of ${s.count}`;
      stem.replaceChildren(await rich(s.question.stem, 'div'));
      opts.replaceChildren();
      status.textContent = s.answered ? 'Saved ✓' : '';
      if (s.question.options) {
        for (const o of s.question.options) {
          const b = h('button', { class: 'option', 'aria-pressed': String(s.answered === o.letter), onclick: () => {
            for (const x of opts.children) x.setAttribute('aria-pressed', 'false');
            b.setAttribute('aria-pressed', 'true');
            save(s.slot, o.letter);
          } }, h('span', { class: 'letter', text: o.letter }), await rich(o.text));
          opts.append(b);
        }
      } else {
        const input = h('input', { inputmode: s.question.type === 'numeric' ? 'decimal' : 'text', autocomplete: 'off', value: s.answered ?? '', placeholder: s.question.type === 'numeric' ? 'Your number' : 'Your answer' });
        const go = h('button', { class: 'primary', text: 'Save answer' });
        const submit = (e) => { e.preventDefault(); if (input.value.trim()) save(s.slot, input.value.trim()); };
        opts.append(h('form', { onsubmit: submit, class: 'stack' }, input, go));
        input.focus({ preventScroll: true });
      }
    }

    async function next() {
      const r = await api('GET', '/api/attempt/slot', undefined, token);
      if (r.offline) { conn.textContent = 'No connection'; conn.className = 'small conn-off'; return false; }
      conn.textContent = '';
      if (r.data.finished) { stop(); resultView(); return true; }
      if (r.status !== 200) { stop(); checkinView(r.data.error); return true; }
      offset = r.data.server_now - performance.now();
      await show(r.data);
      return true;
    }

    let fetching = false;
    async function tick() {
      const now = serverNow();
      const msLeft = slot.closes_at - now;
      left.textContent = `${fmtSecs(msLeft / 1000)} left`;
      bar.firstChild.style.width = `${Math.max(0, Math.min(100, (100 * msLeft) / (slot.closes_at - slot.opens_at)))}%`;
      bar.classList.toggle('low', msLeft < 5000);
      const endAll = slot.closes_at + (slot.count - slot.slot) * (slot.closes_at - slot.opens_at);
      total.textContent = `Quiz ends in ${fmtSecs((endAll - now) / 1000)}`;
      if (pending && !fetching) save(pending.slot, pending.choice);
      if (msLeft <= 0 && !fetching) {
        fetching = true;
        await next();
        fetching = false;
      }
    }
    show(first);
    timer = setInterval(tick, 250);
  }

  // ------------------------------------------------------------ result

  function voidView(reason) {
    body.replaceChildren(note(`The lecturer voided this attempt: ${reason ?? 'no reason given'}`, 'bad'));
  }

  async function resultView() {
    stop();
    const token = attempt.get(code)?.token;
    const r = await api('GET', '/api/attempt/result', undefined, token);
    if (r.data.void) { voidView(r.data.reason); return; }
    if (r.status === 409) { body.replaceChildren(note('Your answers are being marked. This takes a few seconds.'), h('button', { onclick: resultView, text: 'Check again' })); setTimeout(resultView, 4000); return; }
    if (r.status === 402) {
      const email = h('input', { type: 'email', autocomplete: 'email', value: store.get('payer.email') ?? '', placeholder: 'for the Paystack receipt' });
      const pay = h('button', { class: 'primary', text: `Unlock my result: ${naira(r.data.price)}` });
      pay.onclick = async () => {
        store.set('payer.email', email.value.trim());
        pay.disabled = true;
        const p = await api('POST', '/api/pay/init', { product: 'student_result', email: email.value.trim() }, token);
        if (p.data.entitled) return resultView();
        if (p.status !== 200) { toast(p.data.error ?? 'Payment could not start'); pay.disabled = false; return; }
        store.set(`pay.${p.data.reference}`, { back: `#/q/${code}` });
        location.href = p.data.authorization_url;
      };
      body.replaceChildren(h('div', { class: 'card' },
        h('h2', { text: 'Submitted. Your result is ready.' }),
        h('p', { text: `Unlock it for ${naira(r.data.price)} (${r.data.unit}). Payment is by Paystack: card, bank transfer or USSD.` }),
        field('Email for the receipt (yours or a parent\'s)', email), h('div', { style: { marginTop: '12px' } }, pay)));
      return;
    }
    if (r.status !== 200) { body.replaceChildren(note(r.data.error ?? 'Could not load the result', 'bad'), h('button', { onclick: resultView, text: 'Try again' })); return; }
    body.replaceChildren(slip(r.data));
  }

  function slip(d) {
    const topMm = Number(store.get('print.topmm') ?? 0);
    const margin = h('input', { type: 'number', min: 0, max: 120, value: topMm, inputmode: 'numeric' });
    const verifyUrl = `${location.origin}${location.pathname}#/r/${d.result_id}`;
    const el = h('div', { class: 'card slip', style: { '--top-mm': `${topMm}mm` } },
      h('div', { class: 'print-margin' }),
      h('h1', { text: 'Continuous assessment: statement of result' }),
      h('dl', {},
        h('dt', { text: 'Institution' }), h('dd', { text: d.quiz.course?.institution ?? '—' }),
        h('dt', { text: 'Course' }), h('dd', { text: [d.quiz.course?.code, d.quiz.course?.title].filter(Boolean).join(' ') || '—' }),
        h('dt', { text: 'Quiz' }), h('dd', { text: d.quiz.title }),
        h('dt', { text: 'Candidate' }), h('dd', { text: `${d.candidate.name ?? '—'}${d.candidate.self_declared ? ' (self-declared)' : ''}` }),
        h('dt', { text: 'Registration number' }), h('dd', { text: d.candidate.reg_no ?? '—' }),
        h('dt', { text: 'Date' }), h('dd', { text: fmtDay(d.quiz.date) }),
        h('dt', { text: 'Attempted' }), h('dd', { text: String(d.attempted) }),
        h('dt', { text: 'Correct' }), h('dd', { text: String(d.correct) }),
        h('dt', { text: 'Wrong' }), h('dd', { text: String(d.wrong) }),
        h('dt', { text: 'Unanswered' }), h('dd', { text: String(d.unanswered) }),
        h('dt', { text: 'Marks' }), h('dd', { class: 'score', text: `${d.score} / ${d.max}` }),
        h('dt', { text: 'Percentage' }), h('dd', { text: `${d.percent}%` }),
        d.scaled !== null && d.scaled !== undefined ? [h('dt', { text: `Scaled to ${d.scale_to}` }), h('dd', { text: String(d.scaled) })] : null,
        d.grade ? [h('dt', { text: 'Grade' }), h('dd', { text: d.grade })] : null,
        h('dt', { text: 'Result ID' }), h('dd', { text: d.result_id }),
        h('dt', { text: 'Generated' }), h('dd', { text: fmtDate(d.generated_at) })),
      d.gold ? h('p', {}, h('span', { class: 'badge gold', text: 'Gold Certified' }), ` Set by ${d.gold.lecturer}${d.gold.institution ? `, ${d.gold.institution}` : ''}.`) : null,
      h('p', { class: 'small' }, 'Check this result at ', h('a', { href: verifyUrl, text: verifyUrl })),
      h('div', { class: 'no-print row', style: { marginTop: '12px' } },
        h('button', { class: 'primary', onclick: () => window.print(), text: 'Save as PDF or print' }),
        h('div', {}, h('label', { text: 'Top margin for headed paper (mm)' }), margin)));
    margin.oninput = () => { store.set('print.topmm', Number(margin.value) || 0); el.style.setProperty('--top-mm', `${Number(margin.value) || 0}mm`); };
    return el;
  }
}
