// UI pieces shared by the workspace tabs.

import { h, field } from './dom.mjs';
import { DURATIONS, allowedPaces, defaultCount } from '../shared/timing.mjs';

/** Duration and pace selectors; 60 s per question appears only for primary-tier courses. */
export function timingFields(tier, { duration = 15, pace = 30 } = {}) {
  const d = h('select', {}, DURATIONS.map((x) => h('option', { value: x, selected: x === duration, text: `${x} minutes` })));
  const p = h('select', {}, allowedPaces(tier).map((x) => h('option', { value: x, selected: x === pace, text: `${x} seconds per question` })));
  const n = h('div', { class: 'small muted' });
  const update = () => { n.textContent = `${defaultCount(Number(d.value), Number(p.value))} questions`; };
  d.onchange = update;
  p.onchange = update;
  update();
  return {
    el: h('div', {}, h('div', { class: 'row' }, field('Duration', d), field('Time per question', p)), n),
    get: () => ({ duration: Number(d.value), pace: Number(p.value), count: defaultCount(Number(d.value), Number(p.value)) }),
  };
}

export const pagesSpec = ({ from, to, secondHalf, firstHalf, startAnchor, endAnchor }) => ({
  kind: 'pages',
  from: Number(from),
  to: Number(to),
  ...(secondHalf ? { fromPart: 'second-half' } : {}),
  ...(firstHalf ? { toPart: 'first-half' } : {}),
  ...(startAnchor ? { startAnchor } : {}),
  ...(endAnchor ? { endAnchor } : {}),
});

export function describeSelection(sel) {
  if (!sel) return 'No pages chosen';
  if (sel.kind !== 'pages') return 'By headings';
  const a = `${sel.fromPart === 'second-half' ? 'second half of ' : ''}page ${sel.from}`;
  const b = sel.to === sel.from ? '' : ` to ${sel.toPart === 'first-half' ? 'first half of ' : ''}page ${sel.to}`;
  return `${a}${b}${sel.startAnchor ? `, from "${sel.startAnchor}"` : ''}${sel.endAnchor ? `, to "${sel.endAnchor}"` : ''}`;
}
