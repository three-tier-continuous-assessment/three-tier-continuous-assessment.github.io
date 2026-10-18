import { h, naira } from '../dom.mjs';
import { api, cfg, demoQuery } from '../api.mjs';

export default async function landing(root) {
  const code = h('input', { id: 'qcode', inputmode: 'text', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', maxlength: 8, placeholder: 'e.g. 7K3QX2' });
  const open = (e) => {
    e.preventDefault();
    const c = code.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (c.length === 6) location.hash = `#/q/${c}`;
    else code.focus();
  };
  const pricing = await api('GET', '/api/pricing');
  const p = pricing.data?.products;
  root.append(
    h('h1', { text: 'Upload your notes, choose the pages, publish a timed quiz — results in seconds.' }),
    h('p', { class: 'muted', text: 'For primary, secondary and tertiary teaching. Students sit the quizzes free, on their phones.' }),
    h('form', { class: 'card', onsubmit: open },
      h('label', { for: 'qcode', text: 'Sit a quiz: enter the code from your teacher' }),
      code,
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'primary', type: 'submit', text: 'Open the quiz' }))),
    h('div', { class: 'big-actions' },
      h('a', { class: 'btn', href: '#/w', text: 'Lecturer and teacher workspace' })),
    p ? h('p', { class: 'small muted' },
      `Sitting a quiz is free. Your own result: ${naira(p.student_result.price)} (${p.student_result.unit}). `,
      `Class report: ${naira(p.class_report.price)} (${p.class_report.unit}).`) : null,
    cfg.mode === 'live' ? h('p', { class: 'small muted' }, 'To try it first, open ', h('a', { href: '?demo', text: 'the demo' }),
      ', which runs in your browser and stores nothing on a server.') : null,
    demoQuery ? h('p', { class: 'small muted' }, 'This is the demo. ', h('a', { href: location.pathname, text: 'Go to the real site' }), '.') : null,
  );
}
