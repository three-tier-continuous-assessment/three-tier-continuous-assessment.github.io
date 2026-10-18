// Review (brief §2.5): disputed and source-changed questions first; approve, edit or retire.
// Only approved questions enter quizzes; a bulk approval asks for confirmation.

import { h, field, note, toast, busy } from '../dom.mjs';
import { api } from '../api.mjs';
import { rich } from '../render.mjs';

const FILTERS = [['attention', 'Needs attention'], ['draft', 'Drafts'], ['approved', 'Approved'], ['retired', 'Retired'], ['all', 'All']];

export default async function reviewTab(root, { course, token }) {
  const call = (m, p, b) => api(m, p, b, token);
  let filter = 'attention';
  const bar = h('div', { class: 'tabs subtabs' });
  const listEl = h('div');
  const bulk = h('button', { text: 'Approve every draft shown without problems' });
  root.append(h('h2', { text: 'Review' }), bar, h('div', { class: 'row' }, bulk), listEl);
  for (const [id, label] of FILTERS) {
    bar.append(h('button', { 'aria-selected': String(id === filter), onclick: (e) => { filter = id; [...bar.children].forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget))); load(); }, text: label }));
  }
  let shown = [];
  bulk.onclick = busy(bulk, async () => {
    const ids = shown.filter((q) => q.status === 'draft' && !q.problems.length).map((q) => q.id);
    if (!ids.length) { toast('No drafts without problems are shown'); return; }
    if (!confirm(`Approve ${ids.length} question(s)? Approved questions can enter quizzes.`)) return;
    const r = await call('POST', `/api/courses/${course.id}/questions/bulk`, { ids, action: 'approve', confirm: true });
    toast(`${r.data.done?.length ?? 0} approved${r.data.refused?.length ? `, ${r.data.refused.length} refused` : ''}`);
    load();
  });
  await load();

  async function load() {
    const r = await call('GET', `/api/courses/${course.id}/questions`);
    const all = r.data.questions ?? [];
    shown = all.filter((q) => filter === 'all' ? true
      : filter === 'attention' ? q.status === 'draft' && (q.disputed || q.source_changed || q.ai_key || q.problems.length)
        : q.status === filter);
    listEl.replaceChildren(h('p', { class: 'small muted', text: `${shown.length} shown · ${all.filter((q) => q.status === 'approved').length} approved in this course` }));
    if (!shown.length) listEl.append(note(filter === 'attention' ? 'Nothing needs attention.' : 'No questions here.'));
    for (const q of shown) listEl.append(await card(q));
  }

  async function card(q) {
    const b = q.body;
    const flags = [
      q.disputed ? h('span', { class: 'badge bad', text: 'disputed: a second reading gave another answer' }) : null,
      q.source_changed ? h('span', { class: 'badge warn', text: 'its page has changed' }) : null,
      q.ai_key ? h('span', { class: 'badge warn', text: 'key proposed by AI' }) : null,
      ...q.problems.map((p) => h('span', { class: 'badge bad', text: p })),
      h('span', { class: `badge ${q.status === 'approved' ? 'good' : ''}`, text: q.status }),
    ];
    const opts = b.type === 'mcq' || b.type === 'tf'
      ? h('ol', { class: 'opts', type: 'A' }, await Promise.all(b.options.map(async (o) => h('li', { class: o.id === b.key ? 'key' : '' }, await rich(o.text), o.id === b.key ? ' ✓' : ''))))
      : h('p', {}, 'Answer: ', h('span', { class: 'key', text: `${b.key}${b.type === 'numeric' && b.tolerance?.abs ? ` ± ${b.tolerance.abs}` : ''}${b.accepted?.length ? ` (also: ${b.accepted.join(', ')})` : ''}` }));
    const src = q.source.page ? `Page ${q.source.page}: "${q.source.quote}"` : q.source.import ? `Imported (${q.source.import})` : '';
    const el = h('div', { class: 'card qcard' },
      h('div', { class: 'row', style: { gap: '6px' } }, flags),
      h('div', { class: 'stem' }, await rich(b.stem)), opts,
      b.explanation ? h('p', { class: 'small muted' }, 'Explanation: ', b.explanation) : null,
      src ? h('p', { class: 'small muted', text: src }) : null);
    const approve = h('button', { class: 'primary', text: 'Approve' });
    approve.onclick = busy(approve, async () => set({ status: 'approved' }));
    const retire = h('button', { text: q.status === 'retired' ? 'Restore as draft' : 'Retire' });
    retire.onclick = busy(retire, async () => set({ status: q.status === 'retired' ? 'draft' : 'retired' }));
    const edit = h('button', { text: 'Edit' });
    edit.onclick = () => el.replaceWith(editor(q));
    el.append(h('div', { class: 'row', style: { marginTop: '8px' } }, q.status !== 'approved' ? approve : null, edit, retire));
    return el;

    async function set(change) {
      const r = await call('PUT', `/api/questions/${q.id}`, change);
      if (r.status !== 200) { toast(r.data.error ?? 'Not saved', 6000); return; }
      load();
    }
  }

  function editor(q) {
    const b = structuredClone(q.body);
    const stem = h('textarea', { value: b.stem });
    const optInputs = (b.options ?? []).map((o) => h('input', { value: o.text, disabled: b.type === 'tf' }));
    const keyRadios = (b.options ?? []).map((o) => h('input', { type: 'radio', name: `key-${q.id}`, checked: o.id === b.key }));
    const keyText = h('input', { value: b.type === 'mcq' || b.type === 'tf' ? '' : String(b.key ?? '') });
    const tol = h('input', { type: 'number', step: 'any', value: b.tolerance?.abs ?? 0 });
    const expl = h('textarea', { value: b.explanation ?? '' });
    const save = h('button', { class: 'primary', text: 'Save' });
    save.onclick = busy(save, async () => {
      const body = { stem: stem.value, explanation: expl.value };
      if (b.type === 'mcq' || b.type === 'tf') {
        body.options = b.options.map((o, i) => ({ id: o.id, text: optInputs[i].value }));
        const k = keyRadios.findIndex((r) => r.checked);
        body.key = k >= 0 ? b.options[k].id : null;
      } else if (b.type === 'numeric') {
        body.key = Number(keyText.value);
        body.tolerance = { abs: Number(tol.value) || 0 };
      } else body.key = keyText.value;
      const r = await call('PUT', `/api/questions/${q.id}`, { body });
      if (r.status !== 200) { toast(r.data.error ?? 'Not saved', 6000); return; }
      load();
    });
    return h('div', { class: 'card' },
      field('Question', stem),
      b.type === 'mcq' || b.type === 'tf'
        ? h('fieldset', {}, h('legend', { text: 'Options (choose the correct one)' }), b.options.map((o, i) => h('label', { class: 'check' }, keyRadios[i], optInputs[i])))
        : h('div', { class: 'row' }, field('Answer', keyText), b.type === 'numeric' ? field('Tolerance (±)', tol) : null),
      field('Explanation (optional)', expl),
      h('div', { class: 'row', style: { marginTop: '8px' } }, save, h('button', { onclick: load, text: 'Cancel' })));
  }
}
