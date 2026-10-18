// Small DOM helpers. Text always goes in as text nodes; the only HTML path is render.mjs.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}

let toastTimer;
export function toast(message, ms = 3500) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', text: message });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: 'long' }) : '—');
export function fmtSecs(s) {
  const t = Math.max(0, Math.ceil(s));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}
export const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;

export function field(label, input, hint) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', {}, h('label', { for: id, text: label }), input, hint ? h('div', { class: 'small muted', text: hint }) : null);
}

export function note(text, kind = '') {
  return h('div', { class: `note ${kind}`.trim(), role: kind === 'bad' ? 'alert' : 'status', text });
}

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A busy wrapper for buttons: disables the button while the action runs. */
export function busy(button, action) {
  return async (...args) => {
    if (button.disabled) return;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Working…';
    try {
      await action(...args);
    } finally {
      button.disabled = false;
      if (button.textContent === 'Working…') button.textContent = label;
    }
  };
}

/** Datetime-local value <-> milliseconds, in the device's time zone. */
export function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (s) => (s ? new Date(s).getTime() : null);
