// Administration (brief §5.6, §6.2): the verification queue and payment reconciliation.

import { h, field, note, toast, busy, fmtDate } from '../dom.mjs';
import { api, lecturer } from '../api.mjs';

export default async function admin(root) {
  if (!lecturer.token) { location.hash = '#/w'; return; }
  const call = (m, p, b) => api(m, p, b, lecturer.token);
  root.append(h('h1', { text: 'Administration' }));
  const queue = h('div');
  root.append(h('h2', { text: 'Verification queue' }), queue);
  await load();

  async function load() {
    const r = await call('GET', '/api/admin/verifications');
    if (r.status !== 200) { queue.replaceChildren(note(r.data.error, 'bad')); return; }
    queue.replaceChildren();
    if (!r.data.items.length) queue.append(note('Nothing is waiting.'));
    for (const v of r.data.items) {
      const code = h('input', { autocapitalize: 'characters', placeholder: 'GCAES-…' });
      const memo = h('input', { placeholder: 'what you checked' });
      const pass = h('button', { class: 'primary', text: 'Pass' });
      const failB = h('button', { class: 'danger', text: 'Fail' });
      const decide = (decision) => busy(decision === 'pass' ? pass : failB, async () => {
        const x = await call('POST', `/api/admin/verifications/${v.id}`, { decision, observed_code: code.value.trim(), note: memo.value.trim() });
        toast(x.status === 200 ? `Marked ${x.data.status}` : x.data.error, 6000);
        if (x.status === 200) load();
      });
      pass.onclick = decide('pass');
      failB.onclick = decide('fail');
      const link = v.method === 'orcid' ? `https://orcid.org/${v.identifier}` : v.method === 'scholar' ? `https://scholar.google.com/citations?user=${v.identifier}` : v.method === 'scopus' ? `https://orcid.org/${String(v.identifier).split('orcid:')[1]}` : null;
      queue.append(h('div', { class: 'card' },
        h('strong', { text: `${v.name ?? '—'} <${v.email}>` }),
        h('p', { class: 'small', text: `Level ${v.level} · ${v.method} · ${v.identifier ?? ''} · ${fmtDate(v.created_at)}` }),
        v.note ? note(v.note, 'warn') : null,
        link ? h('p', {}, h('a', { href: link, target: '_blank', rel: 'noopener', text: 'Open the public profile' })) : null,
        v.level === 2 ? h('p', { class: 'small muted', text: 'Check that the code is on the profile, that the name matches, and (Scholar) that "Verified email at" shows the same institution. Type the code you see.' }) : null,
        v.level === 2 ? field('Code seen on the profile', code) : null,
        field('Note', memo),
        h('div', { class: 'row', style: { marginTop: '8px' } }, pass, failB)));
    }
  }

  const out = h('div');
  const rec = h('button', { text: 'Compare the last 7 days with Paystack' });
  rec.onclick = busy(rec, async () => {
    const r = await call('GET', '/api/admin/reconcile');
    if (r.status !== 200) { out.replaceChildren(note(r.data.error, 'bad')); return; }
    out.replaceChildren(r.data.items.length
      ? h('ul', {}, r.data.items.map((i) => h('li', { text: `${i.reference}: ${i.problem}` })))
      : note(`All ${r.data.checked} transaction(s) agree.`, 'good'));
  });
  root.append(h('h2', { text: 'Payments' }), rec, out);
}
