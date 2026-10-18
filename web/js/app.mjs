// Hash router (WhatsApp deep links never 404 on Pages). Screens load on demand, so the quiz
// page stays small; each screen may return a cleanup function.

import { h } from './dom.mjs';
import { cfg } from './api.mjs';

const ROUTES = [
  [/^#?\/?$/, () => import('./screens/landing.mjs')],
  [/^#\/q\/([0-9A-Za-z]{6})$/, () => import('./screens/quiz.mjs')],
  [/^#\/w(?:\/([\w-]+))?(?:\/([\w-]+))?$/, () => import('./screens/workspace.mjs')],
  [/^#\/verify$/, () => import('./screens/verify.mjs')],
  [/^#\/admin$/, () => import('./screens/admin.mjs')],
  [/^#\/r\/([\w-]+)$/, () => import('./screens/result-check.mjs')],
  [/^#\/paid\/([\w-]+)$/, () => import('./screens/paid.mjs')],
  [/^#\/test-checkout\/([\w-]+)$/, () => import('./screens/test-checkout.mjs')],
];

const root = document.getElementById('app');
let cleanup = null;

async function route() {
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  const hash = location.hash || '#/';
  for (const [re, load] of ROUTES) {
    const m = re.exec(hash);
    if (!m) continue;
    root.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
    try {
      const mod = await load();
      root.replaceChildren();
      cleanup = await mod.default(root, ...m.slice(1));
    } catch (e) {
      console.error(e);
      root.replaceChildren(h('h1', { text: 'Something went wrong' }), h('p', { text: e.message }), h('a', { href: '#/', text: 'Back to the start' }));
    }
    root.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    return;
  }
  root.replaceChildren(h('h1', { text: 'Page not found' }), h('a', { href: '#/', text: 'Back to the start' }));
}

const badge = document.getElementById('mode');
if (cfg.mode === 'demo') badge.replaceChildren(h('span', { class: 'demo', text: 'Demo: runs in your browser; nothing is stored on a server' }));
else if (cfg.mode === 'dev') badge.replaceChildren(h('span', { class: 'demo', text: 'Development' }));

if (cfg.mode === 'demo') {
  root.replaceChildren(h('p', { class: 'muted', text: 'Starting the demo server in your browser…' }));
  const { startDemo } = await import('./demo.mjs');
  await startDemo();
}
window.addEventListener('hashchange', route);
route();
