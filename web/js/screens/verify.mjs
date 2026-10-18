// Lecturer verification (brief §5.6): Level 1 grants access; Level 1 plus Level 2 or Level 3
// grants Gold Certified status, with no feature locked.

import { h, field, note, toast, busy, fmtDate } from '../dom.mjs';
import { api, lecturer } from '../api.mjs';

const STATUS = { passed: ['good', 'passed'], review: ['warn', 'awaiting review'], issued: ['warn', 'code issued'], failed: ['bad', 'not passed'], revoked: ['bad', 'revoked'] };
const badge = (v) => {
  if (!v) return h('span', { class: 'badge', text: 'not started' });
  const [k, t] = STATUS[v.status] ?? ['', v.status];
  return h('span', { class: `badge ${k}`, text: t });
};

export default async function verify(root) {
  if (!lecturer.token) { location.hash = '#/w'; return; }
  const r = await api('GET', '/api/me', undefined, lecturer.token);
  if (r.status !== 200) { lecturer.clear(); location.hash = '#/w'; return; }
  const m = r.data;
  const L = m.levels;
  root.append(h('h1', { text: 'Verification' }),
    h('p', {}, 'Your status: ', m.tier === 'gold' ? h('span', { class: 'badge gold', text: 'Gold Certified' }) : m.tier === 'verified' ? h('span', { class: 'badge good', text: 'Verified' }) : h('span', { class: 'badge warn', text: 'Not verified' })),
    h('p', { class: 'small muted', text: 'Level 1 gives access to the workspace. Level 1 plus Level 2 or Level 3 (either, or both) gives Gold Certified status: no feature is locked, including open sittings for candidates anywhere.' }));

  // Level 1
  root.append(h('div', { class: 'card' },
    h('h2', {}, 'Level 1 · Institutional email ', badge(L[1])),
    L[1]?.status === 'passed'
      ? h('p', { text: `Verified as ${L[1].identifier}; renew by signing in before ${fmtDate(L[1].expires_at)}.` })
      : h('div', {}, note(m.level1_reason ?? "Sign in with your university's Google account. Student addresses and personal addresses are not accepted.", 'warn'),
        h('p', { class: 'small', text: 'If your institution\'s email is not on Google, ask the administrator: a one-time email code will be added for your institution.' }))));

  // Level 2
  const method = h('select', {}, h('option', { value: 'orcid', text: 'ORCID' }), h('option', { value: 'scholar', text: 'Google Scholar' }), h('option', { value: 'scopus', text: 'Scopus (Elsevier), through ORCID' }));
  const ident = h('input', { placeholder: '0000-0002-1825-0097' });
  const orcid = h('input', { placeholder: 'the ORCID iD whose record lists your Scopus ID' });
  const orcidWrap = field('ORCID iD', orcid);
  orcidWrap.classList.add('hidden');
  method.onchange = () => {
    ident.placeholder = { orcid: '0000-0002-1825-0097', scholar: 'https://scholar.google.com/citations?user=…', scopus: 'Scopus Author ID, e.g. 57190000000' }[method.value];
    orcidWrap.classList.toggle('hidden', method.value !== 'scopus');
  };
  const out2 = h('div');
  const start = h('button', { class: 'primary', text: 'Get my code' });
  start.onclick = busy(start, async () => {
    const x = await api('POST', '/api/verify/research', { method: method.value, identifier: ident.value.trim(), orcid: orcid.value.trim() }, lecturer.token);
    if (x.status !== 200) { out2.replaceChildren(note(x.data.error, 'bad')); return; }
    const done = h('button', { class: 'primary', text: 'I have added the code' });
    done.onclick = busy(done, async () => {
      const y = await api('POST', `/api/verify/research/${x.data.id}/submit`, {}, lecturer.token);
      out2.replaceChildren(y.status === 200 ? note('Thank you. An administrator will check your profile and confirm.', 'good') : note(y.data.error, 'bad'));
    });
    out2.replaceChildren(h('p', {}, 'Your code: ', h('strong', { style: { fontSize: '1.3rem' }, text: x.data.code })), h('p', { text: x.data.instructions }), done);
  });
  root.append(h('div', { class: 'card' },
    h('h2', {}, 'Level 2 · Research identity ', badge(L[2])),
    L[2]?.status === 'passed' ? h('p', { text: `Verified: ${L[2].method} ${L[2].identifier}` }) : h('div', {},
      h('p', { class: 'small muted', text: 'You put a short code on your public profile for a while; an administrator checks it. (ORCID allows automatic sign-in only for members, and Google Scholar and Scopus offer none.)' }),
      field('Profile', method), field('Identifier', ident), orcidWrap, h('div', { style: { marginTop: '10px' } }, start), out2)));

  // Level 3
  const nin = h('input', { inputmode: 'numeric', autocomplete: 'off', maxlength: 11, placeholder: '11 digits' });
  const dob = h('input', { type: 'date' });
  const consent = h('input', { type: 'checkbox' });
  const out3 = h('div');
  const send = h('button', { class: 'primary', text: 'Verify my NIN' });
  send.onclick = busy(send, async () => {
    const x = await api('POST', '/api/verify/nin', { nin: nin.value.replace(/\s/g, ''), dob: dob.value, consent: consent.checked }, lecturer.token);
    nin.value = '';
    if (x.status !== 200) { out3.replaceChildren(note(x.data.error, 'bad')); return; }
    out3.replaceChildren(note(x.data.status === 'passed' ? 'Verified.' : x.data.reason ?? x.data.status, x.data.status === 'passed' ? 'good' : 'warn'));
    if (x.data.status === 'passed') setTimeout(() => window.dispatchEvent(new Event('ttca:rerender')), 1200);
  });
  root.append(h('div', { class: 'card' },
    h('h2', {}, 'Level 3 · NIN ', badge(L[3])),
    L[3]?.status === 'passed' ? h('p', { text: 'Verified.' }) : h('div', {},
      h('p', { class: 'small', text: 'Your NIN is sent once, through our server, to a licensed NIN verification service, which confirms the record and the names on it. We keep only the result, the service\'s reference, the date, and a one-way fingerprint that stops one NIN from certifying two accounts. We never store or show the NIN itself.' }),
      field('NIN', nin), field('Date of birth', dob),
      h('label', { class: 'check' }, consent, h('span', { text: 'I agree to this check of my NIN for the purpose above.' })),
      send, out3)));
}
