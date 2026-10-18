// Question Pool (brief §2.4): paste or upload existing questions. The parsers need no AI;
// "AI assist" handles messy text and missing keys, and its keys await the lecturer's approval.

import { h, note, busy } from '../dom.mjs';
import { api } from '../api.mjs';
import { fileText } from '../extract.mjs';

export default async function poolTab(root, { course, token }) {
  const text = h('textarea', { placeholder: 'Paste questions here: Aiken, GIFT, CSV, or a numbered paper such as\n\n1. Which law defines temperature?\nA. First law\nB. Zeroth law\nC. Second law\nAnswer: B' });
  let filename = '';
  const upload = h('input', { type: 'file', accept: '.txt,.gift,.csv,.json,.docx,.pdf,text/plain', class: 'hidden' });
  upload.onchange = async () => {
    const f = upload.files[0];
    if (!f) return;
    filename = f.name;
    text.value = await fileText(f);
    upload.value = '';
  };
  const out = h('div');
  const imp = h('button', { class: 'primary', text: 'Import' });
  imp.onclick = busy(imp, async () => {
    const r = await api('POST', `/api/courses/${course.id}/pool`, { text: text.value, filename }, token);
    if (r.status !== 201) { out.replaceChildren(note(r.data.error ?? 'Import failed', 'bad')); return; }
    out.replaceChildren(
      note(`Read as ${r.data.format.toUpperCase()}: ${r.data.added} question(s) added as drafts${r.data.needs_key ? `, ${r.data.needs_key} of them without an answer key` : ''}.`, r.data.added ? 'good' : 'warn'),
      r.data.errors.length ? h('details', { open: true }, h('summary', { text: `${r.data.errors.length} problem(s)` }), h('ul', {}, r.data.errors.map((e) => h('li', { text: `line ${e.line}${e.number ? ` (question ${e.number})` : ''}: ${e.message}` })))) : null,
      h('a', { class: 'btn', href: `#/w/${course.id}/review`, text: 'Review and approve' }));
  });
  const ai = h('button', { text: 'AI assist: read messy text and propose missing keys' });
  ai.onclick = busy(ai, async () => {
    const r = await api('POST', `/api/courses/${course.id}/assist`, { text: text.value }, token);
    if (r.status !== 201) { out.replaceChildren(note(r.data.error ?? 'AI assist failed', 'bad')); return; }
    out.replaceChildren(note(`${r.data.added} question(s) added. Every key the AI proposed is marked and waits for your approval.`, 'good'),
      h('a', { class: 'btn', href: `#/w/${course.id}/review`, text: 'Review and approve' }));
  });
  root.append(h('h2', { text: 'Question Pool' }), h('div', { class: 'card' },
    h('p', { text: 'Bring questions you already have. Nothing here needs the AI: the parsers read Aiken and GIFT (Moodle), CSV, JSON, and numbered papers from Word, PDF or text.' }),
    text,
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { onclick: () => upload.click(), text: 'Upload a file' }), imp),
    upload,
    h('div', { style: { marginTop: '10px' } }, ai),
    out));
}
