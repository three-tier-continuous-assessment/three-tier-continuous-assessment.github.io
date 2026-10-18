// Results (brief §6, §7.4): the class report behind its ₦500 unlock, printed to PDF through the
// browser; a CSV with the columns the lecturer chooses; void and reset; bulk unlocks.

import { h, field, note, toast, busy, naira, fmtDate, download } from '../dom.mjs';
import { api, store } from '../api.mjs';
import { toCSV } from '../../shared/csv.mjs';

const COLUMNS = [
  ['seat', 'Seat'], ['reg_no', 'Registration number'], ['name', 'Name'], ['status', 'Status'], ['attempted', 'Attempted'],
  ['correct', 'Correct'], ['wrong', 'Wrong'], ['unanswered', 'Unanswered'], ['score', 'Marks'], ['max', 'Maximum'],
  ['percent', 'Percentage'], ['scaled', 'Scaled'], ['grade', 'Grade'], ['listed', 'On the class list'], ['result_id', 'Result ID'],
];

export default async function resultsTab(root, { course, token }) {
  const call = (m, p, b) => api(m, p, b, token);
  const qs = ((await call('GET', `/api/quizzes?course_id=${course.id}`)).data.quizzes ?? []).filter((z) => z.status !== 'draft');
  root.append(h('h2', { text: 'Results' }));
  if (!qs.length) { root.append(note('Results appear here once a quiz is published.')); return; }
  const pick = h('select', {}, qs.map((z) => h('option', { value: z.id, selected: z.id === store.get('quiz.selected'), text: `${z.title} (${z.code})` })));
  const out = h('div');
  pick.onchange = () => { store.set('quiz.selected', pick.value); load(); };
  root.append(field('Quiz', pick), out);
  await load();

  async function load() {
    const id = pick.value;
    const r = await call('GET', `/api/quizzes/${id}/report`);
    if (r.status === 402) {
      const pay = h('button', { class: 'primary', text: `Unlock the class report: ${naira(r.data.price)}` });
      pay.onclick = busy(pay, async () => {
        const p = await call('POST', '/api/pay/init', { product: 'class_report', quiz_id: id });
        if (p.data.entitled) return load();
        if (p.status !== 200) { toast(p.data.error ?? 'Payment could not start', 6000); return; }
        store.set(`pay.${p.data.reference}`, { back: `#/w/${course.id}/results` });
        location.href = p.data.authorization_url;
      });
      out.replaceChildren(h('div', { class: 'card' },
        h('p', { text: `The class report (${r.data.unit}) gives every candidate's marks, the class statistics and a check of each question, as a PDF and a CSV. Downloading it again later is free.` }),
        pay));
      return;
    }
    if (r.status !== 200) { out.replaceChildren(note(r.data.error ?? 'Could not load the report', 'bad')); return; }
    render(r.data);
  }

  function render(d) {
    const s = d.stats;
    const head = h('div', { class: 'card' },
      h('h1', { text: `${d.quiz.title}: class report` }),
      h('p', { text: [d.course?.code, d.course?.title, d.course?.institution].filter(Boolean).join(' · ') }),
      h('p', { class: 'small', text: `Lecturer: ${d.lecturer ?? '—'} · ${d.quiz.count} questions, ${d.quiz.pace} s each · published ${fmtDate(d.quiz.published_at)}` }),
      d.gold ? h('p', {}, h('span', { class: 'badge gold', text: 'Gold Certified' })) : null,
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        h('tr', {}, h('th', { text: 'Candidates on the roster' }), h('td', { class: 'num', text: String(s.candidates) })),
        h('tr', {}, h('th', { text: 'Submissions' }), h('td', { class: 'num', text: String(s.submissions) })),
        s.submissions ? [
          h('tr', {}, h('th', { text: 'Mean (%)' }), h('td', { class: 'num', text: String(s.mean) })),
          h('tr', {}, h('th', { text: 'Median (%)' }), h('td', { class: 'num', text: String(s.median) })),
          h('tr', {}, h('th', { text: 'Standard deviation' }), h('td', { class: 'num', text: String(s.sd) })),
          h('tr', {}, h('th', { text: 'Highest / lowest (%)' }), h('td', { class: 'num', text: `${s.highest} / ${s.lowest}` })),
          h('tr', {}, h('th', { text: `Pass rate (≥ ${s.pass_mark}%)` }), h('td', { class: 'num', text: `${s.pass_rate}%` })),
        ] : null))),
      s.distribution ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Score band (%)' }), h('th', { class: 'num', text: 'Candidates' }))),
        h('tbody', {}, s.distribution.map((b) => h('tr', {}, h('td', { text: `${b.from}–${Math.floor(b.to)}` }), h('td', { class: 'num', text: String(b.count) })))))) : null);

    const rows = h('div', { class: 'card' }, h('h2', { text: 'Candidates' }), h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Seat', 'Reg no', 'Name', 'Status', 'Marks', '%', d.quiz.scale_to ? `/${d.quiz.scale_to}` : null, 'Grade', ''].filter((x) => x !== null).map((t) => h('th', { text: t })))),
      h('tbody', {}, d.rows.map((r) => h('tr', {},
        h('td', { class: 'num', text: String(r.seat + 1) }),
        h('td', { text: r.reg_no }),
        h('td', {}, r.name ?? '', !r.listed ? h('span', { class: 'badge warn', text: 'not on the list' }) : null),
        h('td', { text: r.status === 'void' ? `void: ${r.void_reason}` : r.status }),
        h('td', { class: 'num', text: r.score === null ? '—' : `${r.score}/${r.max}` }),
        h('td', { class: 'num', text: r.percent === null ? '—' : String(r.percent) }),
        d.quiz.scale_to ? h('td', { class: 'num', text: r.scaled === null ? '—' : String(r.scaled) }) : null,
        h('td', { text: r.grade ?? '' }),
        h('td', { class: 'no-print' }, r.attempt_id ? rowActions(r) : null)))))));

    const items = h('div', { class: 'card' }, h('h2', { text: 'Questions' }),
      h('p', { class: 'small muted', text: 'p: share of candidates who answered correctly. D: share correct among the top 27% minus the bottom 27%. A negative D suggests the key may be wrong.' }),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Question' }), h('th', { class: 'num', text: 'p' }), h('th', { class: 'num', text: 'D' }), h('th', { text: '' }))),
        h('tbody', {}, d.items.map((i) => h('tr', {}, h('td', { text: i.stem }), h('td', { class: 'num', text: String(i.p) }), h('td', { class: 'num', text: String(i.d) }),
          h('td', {}, i.suspect ? h('span', { class: 'badge bad', text: 'check the key' }) : null)))))));

    // CSV with chosen, ordered, renamed columns (remembered per lecturer)
    const saved = store.get('csv.columns') ?? COLUMNS.map(([k, label]) => ({ k, label, on: !['listed', 'result_id'].includes(k) }));
    const colUI = saved.map((c) => {
      const on = h('input', { type: 'checkbox', checked: c.on });
      const name = h('input', { value: c.label, 'aria-label': `Header for ${c.k}` });
      return { c, on, name, el: h('div', { class: 'row', style: { alignItems: 'center' } }, h('label', { class: 'check shrink' }, on), name) };
    });
    const csvBtn = h('button', { class: 'primary', text: 'Download CSV' });
    csvBtn.onclick = () => {
      const cols = colUI.map(({ c, on, name }) => ({ k: c.k, label: name.value.trim() || c.label, on: on.checked }));
      store.set('csv.columns', cols);
      const text = toCSV(cols.filter((c) => c.on).map((c) => ({ key: c.k, header: c.label })), d.rows.map((r) => ({ ...r, seat: r.seat + 1, listed: r.listed ? 'yes' : 'no' })));
      download(`${(d.course?.code ?? 'course').replace(/\s+/g, '')}-${d.quiz.code}-results.csv`, text);
    };

    // Bulk unlock for candidates whose own results are still locked
    const finished = d.rows.filter((r) => r.status === 'finished').map((r) => r.attempt_id);
    const bulk = h('button', { text: `Unlock every finished candidate's own result (${naira(100)} each, only those still locked)` });
    bulk.onclick = busy(bulk, async () => {
      const p = await call('POST', '/api/pay/init', { product: 'bulk_unlock', quiz_id: d.quiz.id, attempt_ids: finished });
      if (p.status !== 200) { toast(p.data.error ?? 'Nothing to unlock', 6000); return; }
      if (!confirm(`Pay ${naira(p.data.amount)} to unlock these results?`)) return;
      store.set(`pay.${p.data.reference}`, { back: `#/w/${course.id}/results` });
      location.href = p.data.authorization_url;
    });

    out.replaceChildren(head, rows, items, h('div', { class: 'card no-print' },
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => window.print(), text: 'Save as PDF or print' }), csvBtn),
      h('details', {}, h('summary', { text: 'Choose, order and rename the CSV columns' }), colUI.map((x) => x.el)),
      finished.length ? h('div', { style: { marginTop: '10px' } }, bulk) : null));
  }

  function rowActions(r) {
    const voidB = h('button', { class: 'danger', text: 'Void' });
    voidB.onclick = async () => {
      const reason = prompt(`Void ${r.name ?? r.reg_no}'s attempt? Give the reason (it is recorded):`);
      if (!reason) return;
      const x = await call('POST', `/api/attempts/${r.attempt_id}/void`, { reason });
      toast(x.status === 200 ? 'Voided' : x.data.error);
      load();
    };
    const reset = h('button', { text: 'Reset' });
    reset.onclick = async () => {
      const reason = prompt(`Let ${r.name ?? r.reg_no} start again? Give the reason (it is recorded):`);
      if (!reason) return;
      const x = await call('POST', `/api/attempts/${r.attempt_id}/reset`, { reason });
      toast(x.status === 200 ? 'Reset: the candidate can start again' : x.data.error);
      load();
    };
    return h('div', { class: 'row' }, r.status !== 'void' ? voidB : null, reset);
  }
}
