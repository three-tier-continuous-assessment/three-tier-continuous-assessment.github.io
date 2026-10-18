// The one place where question and note text becomes HTML (brief §9): everything is escaped,
// then a Markdown subset (**bold**, *italic*, `code`, line breaks) is applied, and TeX between
// $…$, $$…$$, \(…\) or \[…\] is rendered by KaTeX with trust off. KaTeX loads only when needed.

const MATH = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?=\S)[^$\n]*?\S\$|\$\S\$)/g;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = (s) => s
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\n/g, '<br>');

let katexLoading = null;
function loadKatex() {
  if (!katexLoading) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../vendor/katex/katex.min.css', import.meta.url).href;
    document.head.append(link);
    katexLoading = import('../vendor/katex/katex.mjs').then(async (m) => {
      await import('../vendor/katex/contrib/mhchem.mjs');
      return m.default;
    });
  }
  return katexLoading;
}

export async function rich(text, tag = 'span') {
  const parts = String(text ?? '').split(MATH);
  const katex = parts.length > 1 ? await loadKatex().catch(() => null) : null;
  const html = parts.map((p, i) => {
    if (i % 2 === 0) return md(esc(p));
    const display = p.startsWith('$$') || p.startsWith('\\[');
    const src = p.replace(/^(\$\$|\\\[|\\\(|\$)/, '').replace(/(\$\$|\\\]|\\\)|\$)$/, '');
    if (!katex) return `<code>${esc(p)}</code>`;
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore' });
    } catch {
      return `<code>${esc(p)}</code>`;
    }
  }).join('');
  const el = document.createElement(tag);
  el.innerHTML = html;
  return el;
}
