#!/usr/bin/env node
/**
 * Small-screen smoke test (after ~/unn-gpa/tools/mobile-smoke.mjs): drives the main screens in
 * headless Firefox at phone and tablet viewports, and checks what breaks on a phone: sideways
 * scrolling, elements spilling out, tap targets under 44 px, inputs under 16 px (which make
 * mobile browsers zoom).
 *
 * Prerequisites: geckodriver --port 4444, and the app served (npm run dev).
 * Run:  node tools/mobile-smoke.mjs [app-url] [driver-url]
 */
const APP = process.argv[2] ?? 'http://localhost:8790/';
const DRIVER = process.argv[3] ?? 'http://localhost:4444';
const VIEWPORTS = [
  { name: 'small Android / iPhone SE', width: 360, height: 740 },
  { name: 'iPhone 14 / Pixel 7', width: 390, height: 844 },
  { name: 'tablet portrait', width: 768, height: 1024 },
];
const SCREENS = [
  { name: 'landing', hash: '#/', ready: `document.querySelector('#qcode')` },
  { name: 'workspace sign-in', hash: '#/w', ready: `document.querySelector('input[type=email]')` },
  { name: 'unknown quiz', hash: '#/q/ZZZZZZ', ready: `document.body.textContent.includes('Quiz not found')` },
  { name: 'test checkout', hash: '#/test-checkout/ttca_000000000000000000000000', ready: `document.body.textContent.includes('Test checkout')` },
];

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};
async function call(method, path, body) {
  const res = await fetch(`${DRIVER}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json.value;
}

console.log(`\nChecking ${APP} at phone and tablet sizes\n`);
for (const vp of VIEWPORTS) {
  const s = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } } });
  const sid = s.sessionId;
  const exec = (script) => call('POST', `/session/${sid}/execute/sync`, { script, args: [] });
  try {
    // Headless Firefox will not lay out narrower than 500 CSS px, so the app runs in an iframe
    // of the exact size (the development server's /__phone harness).
    await call('POST', `/session/${sid}/window/rect`, { width: Math.max(520, vp.width + 40), height: vp.height + 120, x: 0, y: 0 });
    await call('POST', `/session/${sid}/url`, { url: new URL(`__phone?w=${vp.width}&h=${vp.height}`, APP).href });
    console.log(`  ${vp.name} (${vp.width}×${vp.height})`);
    for (const sc of SCREENS) {
      await call('POST', `/session/${sid}/frame/parent`, {}).catch(() => {});
      await exec(`document.getElementById('phone').contentWindow.location.hash = ${JSON.stringify(sc.hash)}; return true;`);
      const frame = await call('POST', `/session/${sid}/element`, { using: 'css selector', value: '#phone' });
      await call('POST', `/session/${sid}/frame`, { id: frame });
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        try { ready = await exec(`return !!(${sc.ready});`); } catch { /* loading */ }
        if (!ready) await new Promise((r) => setTimeout(r, 100));
      }
      check(`${sc.name}: renders`, ready);
      const width = await exec('return window.innerWidth;');
      check(`${sc.name}: laid out at ${vp.width} px`, width === vp.width, `innerWidth ${width}`);
      const r = await exec(`
        const w = window.innerWidth;
        let spill = null;
        for (const el of document.body.querySelectorAll('*')) {
          if (el.closest('.table-wrap, .tabs, .preview, .hidden')) continue;
          const b = el.getBoundingClientRect();
          if (b.width && (b.right > w + 1 || b.left < -1)) { spill = el.tagName + '.' + el.className; break; }
        }
        const small = [];
        for (const el of document.querySelectorAll('button, a.btn, input:not([type=checkbox]):not([type=radio]), select')) {
          const b = el.getBoundingClientRect();
          if (b.width && b.height < 44) small.push(el.tagName + ':' + (el.textContent || el.name || el.type).trim().slice(0, 24) + ':' + Math.round(b.height));
        }
        const tinyText = [...document.querySelectorAll('input, select, textarea')].filter((el) => el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.type || el.tagName);
        return { doc: document.documentElement.scrollWidth, w, spill, small, tinyText };
      `);
      check(`${sc.name}: no sideways scrolling`, r.doc <= r.w + 1, `${r.doc}px vs ${r.w}px`);
      check(`${sc.name}: nothing spills outside the screen`, !r.spill, r.spill ?? '');
      check(`${sc.name}: tap targets at least 44 px`, r.small.length === 0, r.small.join(', '));
      check(`${sc.name}: inputs at least 16 px (no zoom on focus)`, r.tinyText.length === 0, r.tinyText.join(', '));
    }
  } finally {
    await call('DELETE', `/session/${sid}`).catch(() => {});
  }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
