// Quizzes (brief §4, §5.1, §7.3): drafts from the notes or a CA schedule, settings, question
// generation, questions from the pool, the roster and codes, publication and sharing.

import { h, field, note, toast, busy, fmtDate, toLocalInput, fromLocalInput } from '../dom.mjs';
import { api, store, siteUrl } from '../api.mjs';
import { timingFields, describeSelection } from '../ui.mjs';
import { fittingConfigs, defaultCount } from '../../shared/timing.mjs';

export default async function quizzesTab(root, { course, me, token }) {
  const call = (m, p, b) => api(m, p, b, token);
  const listEl = h('div'), detail = h('div');
  root.append(h('h2', { text: 'Quizzes' }), listEl, detail);
  await renderList();
  const pick = store.get('quiz.selected');
  if (pick) openQuiz(pick);

  async function renderList() {
    const r = await call('GET', `/api/quizzes?course_id=${course.id}`);
    const qs = r.data.quizzes ?? [];
    listEl.replaceChildren();
    if (!qs.length) listEl.append(note('No quizzes yet. Create one from the Notes tab (choose pages, or import a CA schedule).'));
    for (const z of qs) {
      listEl.append(h('button', { class: 'card', style: { width: '100%', display: 'block', textAlign: 'left' }, onclick: () => openQuiz(z.id) },
        h('strong', { text: z.title }), ' ',
        h('span', { class: `badge ${z.status === 'published' ? 'good' : z.status === 'closed' ? '' : 'warn'}`, text: z.status }),
        h('div', { class: 'small muted', text: `${z.count} questions · ${z.pace} s each · ${z.duration} min · ${describeSelection(z.selection)}${z.code ? ` · code ${z.code}` : ''}` })));
    }
  }

  async function openQuiz(id) {
    store.set('quiz.selected', id);
    const r = await call('GET', `/api/quizzes/${id}`);
    if (r.status !== 200) { detail.replaceChildren(note(r.data.error, 'bad')); return; }
    const z = r.data;
    detail.replaceChildren(h('h2', { text: z.title }));
    if (z.status === 'draft') await draftView(z);
    else await publishedView(z);
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ drafts

  async function draftView(z) {
    const qs = (await call('GET', `/api/courses/${course.id}/questions`)).data.questions ?? [];
    const mine = qs.filter((q) => q.source.quiz === z.id);
    const approvedMine = mine.filter((q) => q.status === 'approved').length;
    const chosen = new Set(z.question_ids);
    const available = z.question_ids.length ? z.question_ids.length : approvedMine;

    // Settings
    const title = h('input', { value: z.title });
    const timing = timingFields(course.tier, { duration: z.duration, pace: z.pace });
    const count = h('input', { type: 'number', min: 1, value: z.count, inputmode: 'numeric' });
    const grace = h('input', { type: 'number', min: 0, max: 10, value: z.grace, inputmode: 'numeric' });
    const opens = h('input', { type: 'datetime-local', value: toLocalInput(z.opens_at) });
    const last = h('input', { type: 'datetime-local', value: toLocalInput(z.last_start) });
    const scale = h('input', { type: 'number', min: 0, step: 'any', value: z.scale_to ?? '', placeholder: 'e.g. 10' });
    const bands = h('select', {}, [['none', 'No letter grade'], ['ng-university', 'Nigerian university A–F'], ['waec', 'WAEC A1–F9']].map(([v, t]) => h('option', { value: v, selected: z.bands === v, text: t })));
    const open = h('input', { type: 'checkbox', checked: !!z.open_sitting, disabled: me.tier !== 'gold' });
    const save = h('button', { class: 'primary', text: 'Save settings' });
    save.onclick = busy(save, async () => {
      const t = timing.get();
      const r = await call('PUT', `/api/quizzes/${z.id}`, {
        title: title.value, duration: t.duration, pace: t.pace, count: Math.min(Number(count.value) || t.count, t.count), grace: Number(grace.value),
        opens_at: fromLocalInput(opens.value), last_start: fromLocalInput(last.value), scale_to: scale.value ? Number(scale.value) : null,
        bands: bands.value, open_sitting: open.checked,
      });
      if (r.status !== 200) { toast(r.data.error ?? 'Not saved', 6000); return; }
      toast('Saved');
      openQuiz(z.id);
    });
    detail.append(h('div', { class: 'card' },
      h('h3', { text: 'Settings' }),
      field('Title', title), timing.el,
      h('div', { class: 'row' }, field('Questions in the quiz', count, `At most ${defaultCount(z.duration, z.pace)} for this duration and pace.`), field('Grace for late answers (seconds)', grace)),
      h('div', { class: 'row' }, field('Opens', opens), field('Last start', last)),
      h('div', { class: 'row' }, field('Scale the mark to (optional)', scale, 'e.g. 10, if this quiz counts 10 marks of the CA'), field('Grade bands', bands)),
      h('label', { class: 'check' }, open, h('span', { text: 'Open sitting: anyone with the link may sit, without a roster (Gold Certified only)' })),
      me.tier !== 'gold' ? h('p', { class: 'small muted', text: 'Open sittings need Gold Certified status: Level 1 plus Level 2 or Level 3.' }) : null,
      save));

    // Questions
    const gen = h('button', { class: 'primary', text: `Generate questions from ${describeSelection(z.selection)}` });
    const genOut = h('div');
    gen.disabled = !z.selection;
    gen.onclick = busy(gen, async () => {
      genOut.replaceChildren(note('Writing questions from your pages. This can take a minute.'));
      const r = await call('POST', `/api/courses/${course.id}/generate`, { quiz_id: z.id });
      if (r.status !== 200) { genOut.replaceChildren(note(r.data.error ?? 'Generation failed', 'bad')); return; }
      const fits = fittingConfigs(course.tier, approvedMine + r.data.added).map((c) => `${c.duration} min at ${c.pace} s`).join(', ');
      genOut.replaceChildren(
        note(`${r.data.added} draft question(s) written${r.data.disputed ? `, ${r.data.disputed} disputed` : ''}; ${r.data.discarded.length} discarded by the checks.`, r.data.added ? 'good' : 'warn'),
        r.data.fewer_than_planned ? note(`These pages support fewer questions than planned. Settings that fit: ${fits || 'none yet'}.`, 'warn') : null,
        r.data.discarded.length ? h('details', {}, h('summary', { text: 'Why some were discarded' }), h('ul', {}, r.data.discarded.map((d) => h('li', { text: `${d.stem ?? '(no text)'} — ${d.reasons.join('; ')}` })))) : null,
        h('a', { class: 'btn', href: `#/w/${course.id}/review`, text: 'Review and approve them' }));
    });
    const pool = qs.filter((q) => q.status === 'approved' && q.source.quiz !== z.id);
    const poolBox = h('div');
    if (pool.length) {
      const boxes = pool.map((q) => h('input', { type: 'checkbox', checked: chosen.has(q.id) }));
      const useSel = h('button', { text: 'Use the ticked questions for this quiz' });
      useSel.onclick = busy(useSel, async () => {
        const ids = pool.filter((_, i) => boxes[i].checked).map((q) => q.id);
        const extra = mine.filter((q) => q.status === 'approved').map((q) => q.id);
        const r = await call('PUT', `/api/quizzes/${z.id}`, { question_ids: ids.length ? [...extra, ...ids] : [] });
        toast(r.status === 200 ? 'Saved' : r.data.error);
        openQuiz(z.id);
      });
      poolBox.append(h('details', {}, h('summary', { text: `Add approved questions from the pool (${pool.length})` }),
        pool.map((q, i) => h('label', { class: 'check' }, boxes[i], h('span', { text: q.body.stem }))), useSel));
    }
    detail.append(h('div', { class: 'card' },
      h('h3', { text: 'Questions' }),
      h('p', { text: `${available} approved question(s) ready; this quiz needs ${z.count}.` }),
      available < z.count ? note(`Approve at least ${z.count - available} more, or lower the number of questions.`, 'warn') : note('Enough approved questions.', 'good'),
      gen, genOut, poolBox));

    // Roster
    const csv = h('textarea', { placeholder: 'Reg No,Name,Email\n2019/123456,Chidi Eze,\n…' });
    const upload = h('input', { type: 'file', accept: '.csv,text/csv,.txt', class: 'hidden' });
    upload.onchange = async () => { if (upload.files[0]) csv.value = await upload.files[0].text(); upload.value = ''; };
    const codes = h('input', { type: 'checkbox', checked: course.tier === 'primary' });
    const rosterOut = h('div');
    const saveRoster = h('button', { class: 'primary', text: 'Save roster' });
    saveRoster.onclick = busy(saveRoster, async () => {
      const r = await call('POST', `/api/quizzes/${z.id}/roster`, { csv: csv.value, codes: codes.checked });
      if (r.status !== 200) { rosterOut.replaceChildren(note(r.data.error ?? 'Roster not saved', 'bad')); return; }
      rosterOut.replaceChildren(note(`${r.data.rows} candidate(s) on the roster.`, 'good'), r.data.codes ? codeSheet(z, r.data.codes) : null);
    });
    detail.append(h('div', { class: 'card' },
      h('h3', { text: `Roster${z.roster.length ? ` (${z.roster.length})` : ''}` }),
      h('p', { class: 'small muted', text: 'A CSV with a registration-number column, and optionally name, email and phone. Seats are bound to registration numbers; late registrants take spare seats in the order they arrive.' }),
      csv, h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { onclick: () => upload.click(), text: 'Upload CSV' })), upload,
      h('label', { class: 'check' }, codes, h('span', { text: 'Issue a candidate code to each student (for pupils, or anyone without Google)' })),
      saveRoster, rosterOut));

    // Publish
    const pub = h('button', { class: 'primary', text: 'Publish the quiz' });
    const pubOut = h('div');
    pub.onclick = busy(pub, async () => {
      if (!confirm('Publish? The questions and roster are then fixed.')) return;
      const r = await call('POST', `/api/quizzes/${z.id}/publish`, {});
      if (r.status !== 200) { pubOut.replaceChildren(note(r.data.error ?? 'Not published', 'bad')); return; }
      openQuiz(z.id);
    });
    detail.append(h('div', { class: 'card' }, h('h3', { text: 'Publish' }), pub, pubOut));
  }

  function codeSheet(z, codes) {
    const sheet = h('div', { class: 'card' },
      h('h3', { text: `${z.title}: candidate codes` }),
      note('These codes are shown only once. Print them or save them as PDF now.', 'warn'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Reg no' }), h('th', { text: 'Name' }), h('th', { text: 'Code' }))),
        h('tbody', {}, codes.map((c) => h('tr', {}, h('td', { text: c.reg_no }), h('td', { text: c.name ?? '' }), h('td', {}, h('code', { text: c.code }))))))),
      h('button', { class: 'no-print', onclick: () => window.print(), text: 'Print the codes' }));
    return sheet;
  }

  // ------------------------------------------------------------ published

  async function publishedView(z) {
    const link = siteUrl(`#/q/${z.code}`);
    const share = `https://wa.me/?text=${encodeURIComponent(`${z.title}\n${link}`)}`;
    const statusEl = h('div');
    const refresh = async () => {
      const s = await call('GET', `/api/quizzes/${z.id}/status`);
      if (s.status !== 200) return;
      statusEl.replaceChildren(h('p', { text: `On the roster: ${s.data.roster} · checked in: ${s.data.checked_in} · started: ${s.data.started} · finished: ${s.data.finished}${s.data.unlisted ? ` · not on the list: ${s.data.unlisted}` : ''}` }));
    };
    await refresh();
    const timer = setInterval(() => { if (!document.body.contains(statusEl)) clearInterval(timer); else refresh(); }, 10_000);
    const opens = h('input', { type: 'datetime-local', value: toLocalInput(z.opens_at) });
    const last = h('input', { type: 'datetime-local', value: toLocalInput(z.last_start) });
    const saveWin = h('button', { text: 'Save the window' });
    saveWin.onclick = busy(saveWin, async () => {
      const r = await call('PUT', `/api/quizzes/${z.id}`, { opens_at: fromLocalInput(opens.value), last_start: fromLocalInput(last.value) });
      toast(r.status === 200 ? 'Saved' : r.data.error);
    });
    const close = h('button', { class: 'danger', text: 'Close the quiz' });
    close.onclick = busy(close, async () => {
      if (!confirm('Close the quiz? No one can check in or start afterwards.')) return;
      await call('PUT', `/api/quizzes/${z.id}`, { status: 'closed' });
      openQuiz(z.id);
    });
    detail.append(h('div', { class: 'card' },
      h('p', {}, h('span', { class: 'badge good', text: z.status }), ` Published ${fmtDate(z.published_at)}`),
      h('p', {}, 'Quiz code: ', h('strong', { style: { fontSize: '1.4rem', letterSpacing: '.1em' }, text: z.code })),
      h('p', {}, h('a', { href: link, text: link })),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: share, target: '_blank', rel: 'noopener', text: 'Share on WhatsApp' }),
        h('button', { onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link, 8000); } }, text: 'Copy link' })),
      statusEl,
      h('div', { class: 'row' }, field('Opens', opens), field('Last start', last)), saveWin,
      h('div', { style: { marginTop: '12px' } }, h('a', { class: 'btn', href: `#/w/${course.id}/results`, text: 'Results' }), ' ', z.status === 'published' ? close : null)));
  }
}
