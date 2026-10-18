// Where Paystack returns the payer. The page asks the server to verify the payment; it never
// unlocks anything on its own say-so.

import { h, note } from '../dom.mjs';
import { api, store } from '../api.mjs';

export default async function paid(root, reference) {
  const back = store.get(`pay.${reference}`)?.back ?? '#/';
  const msg = h('div');
  root.append(h('h1', { text: 'Checking your payment' }), msg, h('a', { class: 'btn primary', href: back, text: 'Continue' }));
  for (let i = 0; i < 6; i++) {
    const r = await api('POST', '/api/pay/verify', { reference });
    if (r.data.status === 'success') {
      msg.replaceChildren(note('Payment confirmed. Your item is unlocked.', 'good'));
      store.del(`pay.${reference}`);
      return;
    }
    if (r.data.status === 'mismatch') { msg.replaceChildren(note('The amount paid does not match the price. Please contact support with your reference.', 'bad')); return; }
    if (r.data.status === 'failed' || r.data.status === 'reversed') { msg.replaceChildren(note('The payment did not go through. You have not been charged for this item.', 'bad')); return; }
    msg.replaceChildren(note('Waiting for Paystack to confirm…'));
    await new Promise((res) => setTimeout(res, 2500));
  }
  msg.replaceChildren(note('Paystack has not confirmed yet. If you were charged, your item unlocks automatically the next time you open it.', 'warn'));
}
