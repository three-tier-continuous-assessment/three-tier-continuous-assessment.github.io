// The lecturer workspace (brief §2, §7): sign-in, course picker, and the tabs
// My Material (Notes | Question Pool | Review), Quizzes, Results.

import { h, field, note, toast } from '../dom.mjs';
import { api, lecturer, store } from '../api.mjs';
import { googleSignIn } from '../signin.mjs';

const TABS = [
  ['notes', 'Notes', 'material'],
  ['pool', 'Question Pool', 'material'],
  ['review', 'Review', 'material'],
  ['quizzes', 'Quizzes'],
  ['results', 'Results'],
];

export default async function workspace(root, courseId, tab = 'notes') {
  if (!lecturer.token) return signInView(root);
  const me = await api('GET', '/api/me', undefined, lecturer.token);
  if (me.status === 401) { lecturer.clear(); return signInView(root); }
  if (me.status !== 200) { root.append(note(me.data.error ?? 'Could not load your account', 'bad')); return; }
  lecturer.save(lecturer.token, me.data);
  const m = me.data;

  root.append(h('div', { class: 'row', style: { alignItems: 'center' } },
    h('div', {}, h('strong', { text: m.user.name ?? m.user.email }), ' ',
      m.tier === 'gold' ? h('span', { class: 'badge gold', text: 'Gold Certified' }) : m.tier === 'verified' ? h('span', { class: 'badge good', text: 'Verified' }) : h('span', { class: 'badge warn', text: 'Not verified' })),
    h('div', { class: 'shrink row' },
      h('a', { class: 'btn', href: '#/verify', text: 'Verification' }),
      m.admin ? h('a', { class: 'btn', href: '#/admin', text: 'Admin' }) : null,
      h('button', { onclick: () => { lecturer.clear(); location.hash = '#/w'; window.dispatchEvent(new Event('ttca:rerender')); }, text: 'Sign out' }))));

  if (m.tier === 'none' && !m.admin) {
    root.append(h('h1', { text: 'Verification needed' }),
      note(m.level1_reason ?? "Lecturer access needs Level 1: sign in with your institution's Google account (not a student address).", 'warn'),
      h('a', { class: 'btn primary', href: '#/verify', text: 'See the verification levels' }));
    return;
  }

  const courses = (await api('GET', '/api/courses', undefined, lecturer.token)).data.courses ?? [];
  const chosen = courses.find((c) => c.id === courseId) ?? courses.find((c) => c.id === store.get('course')) ?? courses[0];
  if (!chosen) return newCourseView(root, true);
  store.set('course', chosen.id);
  if (!courseId) { history.replaceState(null, '', `#/w/${chosen.id}/${tab}`); }

  const select = h('select', { onchange: () => { location.hash = select.value === 'new' ? '#/w/new' : `#/w/${select.value}/${tab}`; } },
    courses.map((c) => h('option', { value: c.id, selected: c.id === chosen.id, text: [c.code, c.title].filter(Boolean).join(' · ') })),
    h('option', { value: 'new', text: '+ New course' }));
  if (courseId === 'new') return newCourseView(root, false);
  root.append(field('Course', select));

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const sub = h('div', { class: 'tabs subtabs', role: 'tablist' });
  const material = TABS.filter((t) => t[2] === 'material');
  const top = [['material', 'My Material'], ['quizzes', 'Quizzes'], ['results', 'Results']];
  const activeTop = material.some((t) => t[0] === tab) ? 'material' : tab;
  for (const [id, label] of top) {
    tabs.append(h('button', { role: 'tab', 'aria-selected': String(id === activeTop), onclick: () => { location.hash = `#/w/${chosen.id}/${id === 'material' ? 'notes' : id}`; }, text: label }));
  }
  if (activeTop === 'material') {
    for (const [id, label] of material) {
      const text = id === 'notes' ? (chosen.tier === 'tertiary' ? 'Lecture Notes' : 'Lesson Notes') : label;
      sub.append(h('button', { role: 'tab', 'aria-selected': String(id === tab), onclick: () => { location.hash = `#/w/${chosen.id}/${id}`; }, text }));
    }
  }
  const panel = h('div', { role: 'tabpanel' });
  root.append(tabs, activeTop === 'material' ? sub : null, panel);
  const mod = await import(`./ws-${TABS.some((t) => t[0] === tab) ? tab : 'notes'}.mjs`);
  return mod.default(panel, { course: chosen, me: m, token: lecturer.token });
}

function signInView(root) {
  const slot = h('div');
  root.append(h('h1', { text: 'Lecturer and teacher workspace' }),
    h('p', { text: "Sign in with your institution's Google account. A personal or student address cannot open the workspace." }),
    slot);
  googleSignIn(slot, { lecturer: true, title: 'Sign in', onToken: async (idToken) => {
    const r = await api('POST', '/api/auth/google', { id_token: idToken });
    if (r.status !== 200) { toast(r.data.error ?? 'Sign-in failed'); return; }
    lecturer.save(r.data.token, r.data);
    window.dispatchEvent(new Event('ttca:rerender'));
  } });
}

function newCourseView(root, first) {
  const title = h('input', { required: true, placeholder: 'e.g. Engineering Thermodynamics' });
  const code = h('input', { placeholder: 'e.g. MEE 321' });
  const inst = h('input', { placeholder: 'e.g. University of Nigeria, Nsukka' });
  const level = h('input', { placeholder: 'e.g. 300 level, SS2, Primary 5' });
  const tier = h('select', {}, h('option', { value: 'tertiary', text: 'Tertiary' }), h('option', { value: 'secondary', text: 'Secondary' }), h('option', { value: 'primary', text: 'Primary' }));
  root.append(h('h1', { text: first ? 'Create your first course' : 'New course' }), h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    const r = await api('POST', '/api/courses', { title: title.value, code: code.value, institution: inst.value, level: level.value, tier: tier.value }, lecturer.token);
    if (r.status !== 201) { toast(r.data.error ?? 'Could not create the course'); return; }
    location.hash = `#/w/${r.data.id}/notes`;
  } }, field('Title', title), h('div', { class: 'row' }, field('Code', code), field('Tier', tier)), field('Institution', inst), field('Level or class', level),
  h('div', { style: { marginTop: '12px' } }, h('button', { class: 'primary', type: 'submit', text: 'Create course' }))));
}
