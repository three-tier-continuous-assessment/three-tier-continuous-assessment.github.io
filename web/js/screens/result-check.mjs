// Public check of a result slip by its ID: initials, quiz and score only.

import { h, note, fmtDay } from '../dom.mjs';
import { api } from '../api.mjs';

export default async function resultCheck(root, id) {
  const r = await api('GET', `/api/results/${id}`);
  root.append(h('h1', { text: 'Result check' }));
  if (r.status !== 200) { root.append(note(r.data.error ?? 'No result has this ID.', 'bad')); return; }
  const d = r.data;
  root.append(h('div', { class: 'card slip' }, h('dl', {},
    h('dt', { text: 'Candidate' }), h('dd', { text: d.initials || '—' }),
    h('dt', { text: 'Quiz' }), h('dd', { text: d.quiz }),
    h('dt', { text: 'Course' }), h('dd', { text: [d.course?.code, d.course?.title].filter(Boolean).join(' ') || '—' }),
    h('dt', { text: 'Institution' }), h('dd', { text: d.course?.institution ?? '—' }),
    h('dt', { text: 'Date' }), h('dd', { text: fmtDay(d.date) }),
    h('dt', { text: 'Marks' }), h('dd', { text: `${d.score} / ${d.max} (${d.percent}%)` }),
    d.grade ? [h('dt', { text: 'Grade' }), h('dd', { text: d.grade })] : null),
    d.gold ? h('p', {}, h('span', { class: 'badge gold', text: 'Gold Certified' }), ` Set by ${d.gold.lecturer}.`) : null,
    note('This record matches a result issued by this system.', 'good')));
}
