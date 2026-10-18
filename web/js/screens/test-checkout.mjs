// The test checkout used in development and in the demo: no money moves.

import { h, note } from '../dom.mjs';
import { api, cfg } from '../api.mjs';

export default async function testCheckout(root, reference) {
  if (cfg.mode === 'live') {
    root.append(h('h1', { text: 'Not available' }), note('Test payments exist only in development and in the demo.', 'bad'));
    return;
  }
  const pay = h('button', { class: 'primary', text: 'Pay (test: no money moves)' });
  pay.onclick = async () => {
    pay.disabled = true;
    const r = await api('POST', '/api/pay/test-complete', { reference });
    if (r.status === 200) location.hash = `#/paid/${reference}`;
    else { pay.disabled = false; root.append(note(r.data.error ?? 'failed', 'bad')); }
  };
  root.append(
    h('h1', { text: 'Test checkout' }),
    note('This page stands in for Paystack in the demo and in development. The real site sends you to Paystack instead.', 'warn'),
    h('p', { class: 'small muted', text: `Reference ${reference}` }),
    h('div', { class: 'row' }, pay, h('a', { class: 'btn', href: `#/paid/${reference}`, text: 'Cancel' })));
}
