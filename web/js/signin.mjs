// Sign in with Google. Live: Google Identity Services. Development and demo: a simulated Google
// account (clearly labelled), which produces the fake tokens the fake verifier accepts.

import { h, field } from './dom.mjs';
import { cfg } from './api.mjs';

let gis = null;
function loadGIS() {
  gis ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('could not load Google sign-in'));
    document.head.append(s);
  });
  return gis;
}

/** Renders a sign-in control into `container`; calls onToken(idToken). */
export async function googleSignIn(container, { onToken, title = 'Sign in with Google', lecturer = false } = {}) {
  container.replaceChildren();
  if (cfg.mode === 'live') {
    const slot = h('div');
    container.append(slot);
    const google = await loadGIS();
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (r) => onToken(r.credential), ux_mode: 'popup' });
    google.accounts.id.renderButton(slot, { theme: 'outline', size: 'large', text: 'signin_with', width: Math.min(360, container.clientWidth || 320) });
    return;
  }
  // Simulated Google account (development and demo only).
  const name = h('input', { autocomplete: 'name', placeholder: 'e.g. Ada Obi' });
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: lecturer ? 'e.g. firstname.lastname@unn.edu.ng' : 'e.g. you@gmail.com' });
  const managed = h('input', { type: 'checkbox', checked: lecturer });
  const go = h('button', { class: 'primary', type: 'submit', text: title });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    const addr = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { email.focus(); return; }
    const { fakeGoogleToken } = await import('../worker/src/services/google.mjs');
    const domain = addr.split('@')[1];
    onToken(fakeGoogleToken({ sub: `demo:${addr}`, email: addr, name: name.value.trim() || addr.split('@')[0], hd: managed.checked ? domain : undefined }));
  } },
  h('p', { class: 'small' }, h('span', { class: 'demo', text: cfg.mode === 'demo' ? 'Demo' : 'Development' }), ' Simulated Google account: no real sign-in takes place.'),
  field('Name on the Google account', name),
  field('Email address', email),
  h('label', { class: 'check' }, managed, h('span', { text: "This address is my institution's Google Workspace account" })),
  go);
  container.append(form);
}
