#!/usr/bin/env node
/**
 * End-to-end browser flow in headless Firefox, over raw WebDriver (no dependencies), against the
 * development server: a lecturer signs in, creates a course, uploads notes, makes a short quiz
 * from pages 1-3, generates and approves questions, issues a roster code and publishes; a
 * candidate checks in with the code, answers, waits for the end, pays (test checkout) and sees
 * the result slip; the lecturer unlocks the class report.
 *
 * Prerequisites: geckodriver --port 4444; the app served (npm run dev, preferably MEMORY=1).
 * Run:  node tools/browser-flow.mjs [app-url] [driver-url]
 */
import { fileURLToPath } from 'node:url';

const APP = process.argv[2] ?? 'http://localhost:8790/';
const DRIVER = process.argv[3] ?? 'http://localhost:4444';
const NOTES = fileURLToPath(new URL('../tests/fixtures/notes-thermo.md', import.meta.url));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
  return ok;
};
async function call(method, path, body) {
  const res = await fetch(`${DRIVER}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const session = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } } });
const sid = session.sessionId;
const exec = (script, args = []) => call('POST', `/session/${sid}/execute/sync`, { script, args });
// The app runs in an iframe at phone size (see /__phone in the development server).
const W = 390, H = 844;
async function go(hash) {
  await call('POST', `/session/${sid}/frame/parent`, {}).catch(() => {});
  await exec(`document.getElementById('phone').contentWindow.location.hash = ${JSON.stringify(hash)}; return true;`);
  const frame = await call('POST', `/session/${sid}/element`, { using: 'css selector', value: '#phone' });
  await call('POST', `/session/${sid}/frame`, { id: frame });
}
async function waitFor(js, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await exec(`return !!(${js});`)) return true; } catch { /* page navigating */ }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const clickText = (text, sel = 'button, a') => exec(`
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}) && !e.disabled);
  if (!el) return false; el.click(); return true;`);
async function acceptAlerts(n = 1) {
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 40; t++) {
      try { await call('POST', `/session/${sid}/alert/accept`, {}); break; } catch { await sleep(100); }
    }
  }
}
async function layoutOK(name) {
  const r = await exec(`
    const w = window.innerWidth;
    let spill = null;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('.table-wrap, .tabs, .preview, .hidden')) continue;
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > w + 1 || b.left < -1)) { spill = el.tagName + '.' + el.className; break; }
    }
    const small = [...document.querySelectorAll('button, a.btn, input:not([type=checkbox]):not([type=radio]), select')]
      .filter((el) => { const b = el.getBoundingClientRect(); return b.width && b.height < 44; }).map((el) => (el.textContent || el.type).trim().slice(0, 20));
    return { doc: document.documentElement.scrollWidth, w, spill, small };`);
  check(`${name}: fits the phone screen, 44 px targets`, r.doc <= r.w + 1 && !r.spill && !r.small.length, JSON.stringify({ doc: r.doc, w: r.w, spill: r.spill, small: r.small }));
}
const setValue = (selector, value) => exec(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;`);

try {
  await call('POST', `/session/${sid}/window/rect`, { width: 520, height: 1000, x: 0, y: 0 });
  await call('POST', `/session/${sid}/url`, { url: new URL(`__phone?w=${W}&h=${H}`, APP).href });
  console.log(`\nBrowser flow against ${APP}\n`);

  // Lecturer signs in with a simulated Workspace account.
  await go('#/w');
  await waitFor(`document.querySelector('input[type=email]')`, 'the sign-in form');
  await setValue('input[autocomplete=name]', 'Ada Obi');
  await setValue('input[type=email]', 'ada.obi@unn.edu.ng');
  await exec(`document.querySelector('form.card button[type=submit]').click();`);
  await waitFor(`document.body.textContent.includes('Create your first course')`, 'the new-course form');
  check('a staff address signs in to the workspace', true);

  await setValue('input[placeholder^="e.g. Engineering"]', 'Engineering Thermodynamics');
  await setValue('input[placeholder^="e.g. MEE"]', 'MEE 999');
  await exec(`document.querySelector('form.card').requestSubmit();`);
  await waitFor(`document.body.textContent.includes('Add notes')`, 'the Notes tab');
  check('a course is created and the workspace opens on Notes', await exec(`return document.body.textContent.includes('Lecture Notes');`));

  // Upload the fixture notes through the real file input.
  const input = await call('POST', `/session/${sid}/element`, { using: 'css selector', value: 'input[type=file][multiple]:not([capture])' });
  const ref = Object.values(input)[0];
  await exec(`document.querySelectorAll('input[type=file]').forEach((i) => i.classList.remove('hidden'));`);
  await call('POST', `/session/${sid}/element/${ref}/value`, { text: NOTES });
  await waitFor(`document.body.textContent.includes('Save to this course')`, 'the staged file');
  check('the uploaded Markdown file splits into three pages', await exec(`return document.querySelectorAll('.pages .thumb').length;`) === 3);
  await exec(`[...document.querySelectorAll('label.check')].find((l) => l.textContent.includes('I have the right')).querySelector('input').click();`);
  await clickText('Save to this course');
  await waitFor(`document.body.textContent.includes('numbered 1–3')`, 'the saved file');
  check('the notes are saved with pages numbered 1-3', true);
  await layoutOK('the Notes tab');

  // Choose pages 1-3 and create a quiz.
  await exec(`
    const labels = [...document.querySelectorAll('label')];
    const byText = (t) => document.getElementById(labels.find((l) => l.textContent === t).htmlFor);
    byText('From page').value = '1'; byText('To page').value = '3';
    byText('Quiz title').value = 'CA1: Foundations';
    return true;`);
  await clickText('Preview the selected text');
  await waitFor(`document.querySelector('.preview')`, 'the preview');
  check('the preview shows pages 1 to 3', await exec(`return document.querySelector('.preview').textContent.includes('[page 3]');`));
  await clickText('Create a quiz from these pages');
  await waitFor(`document.body.textContent.includes('Generate questions from')`, 'the quiz draft');
  check('a quiz draft opens in the Quizzes tab', true);

  // A short quiz for the test: 4 questions at 10 s (4! = 24 orders covers 1 seat + 10 spares).
  await exec(`
    const labels = [...document.querySelectorAll('label')];
    const byText = (t) => document.getElementById(labels.find((l) => l.textContent === t).htmlFor);
    byText('Time per question').value = '10'; byText('Time per question').dispatchEvent(new Event('change'));
    byText('Questions in the quiz').value = '4';
    return true;`);
  await clickText('Save settings');
  await waitFor(`document.body.textContent.includes('this quiz needs 4')`, 'saved settings');
  await clickText('Generate questions from');
  await waitFor(`document.body.textContent.includes('draft question(s) written')`, 'generation', 30000);
  check('questions are generated from the selected pages', await exec(`return /([1-9]\\d*) draft question/.test(document.body.textContent);`));

  // Approve the drafts in Review.
  await clickText('Review and approve them');
  await waitFor(`document.body.textContent.includes('Needs attention')`, 'the Review tab');
  await clickText('Drafts', '.tabs button');
  await waitFor(`document.querySelectorAll('.qcard').length > 0`, 'draft questions');
  await clickText('Approve every draft shown');
  await acceptAlerts(1);
  await waitFor(`document.body.textContent.includes('No questions here') || /\\b[1-9]\\d* approved in this course/.test(document.body.textContent)`, 'approval');
  check('the drafts are approved', await exec(`return /\\b[1-9]\\d* approved in this course/.test(document.body.textContent);`));

  // Roster with a candidate code, then publish.
  await clickText('Quizzes', '.tabs button');
  await waitFor(`document.body.textContent.includes('Save roster')`, 'the quiz page');
  await exec(`document.querySelector('textarea[placeholder^="Reg No"]').value = 'Reg No,Name\\n2019/100001,Chidi Eze\\n'; return true;`);
  await exec(`[...document.querySelectorAll('label.check')].find((l) => l.textContent.includes('Issue a candidate code')).querySelector('input').checked = true; return true;`);
  await clickText('Save roster');
  await waitFor(`document.querySelector('table code')`, 'the code sheet');
  const candidateCode = await exec(`return document.querySelector('table code').textContent;`);
  check('a candidate code is issued', /^[0-9A-Z]{8}$/.test(candidateCode), candidateCode);
  await clickText('Publish the quiz');
  await acceptAlerts(1);
  await waitFor(`document.body.textContent.includes('Quiz code:')`, 'publication');
  const quizCode = await exec(`return [...document.querySelectorAll('strong')].find((s) => /^[0-9A-Z]{6}$/.test(s.textContent)).textContent;`);
  check('the quiz is published with a six-character code', /^[0-9A-Z]{6}$/.test(quizCode), quizCode);
  const courseHash = await exec(`return location.hash.split('/').slice(0, 3).join('/');`);

  // The candidate sits it.
  await go(`#/q/${quizCode}`);
  await waitFor(`document.body.textContent.includes('I have a code')`, 'the check-in');
  await setValue('input[autocomplete=one-time-code]', candidateCode.toLowerCase());
  await clickText('Check in');
  await waitFor(`document.body.textContent.includes('Is this you?')`, 'identity confirmation');
  check('check-in by code shows the roster name', await exec(`return document.body.textContent.includes('Chidi Eze');`));
  await clickText('Yes, continue');
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Start the quiz' && !b.disabled)`, 'the Start button');
  await clickText('Start the quiz');
  await waitFor(`document.querySelectorAll('.option').length === 4`, 'the first question');
  check('question 1 of 4 is shown with four options', await exec(`return document.body.textContent.includes('Question 1 of 4');`));
  const leaked = await exec(`return /"key"|explanation/.test(document.documentElement.outerHTML);`);
  check('the page holds no answer key', !leaked);
  await layoutOK('a running question');
  await exec(`document.querySelector('.option').click(); return true;`);
  await waitFor(`document.body.textContent.includes('Saved ✓')`, 'the saved answer');
  check('a tapped answer is saved', true);
  await waitFor(`document.body.textContent.includes('Question 2 of 4')`, 'question 2', 15000);
  check('question 2 appears when slot 1 closes', true);
  await waitFor(`document.body.textContent.includes('Your result is ready')`, 'the end of the quiz', 70000);
  check('the result is ready seconds after the last question', true);

  await setValue('input[type=email]', 'parent@example.com');
  await clickText('Unlock my result');
  await waitFor(`document.body.textContent.includes('Test checkout')`, 'the test checkout');
  await clickText('Pay (test');
  await waitFor(`document.body.textContent.includes('Payment confirmed')`, 'payment confirmation');
  await clickText('Continue');
  await waitFor(`document.querySelector('.slip')`, 'the result slip');
  check('the result slip shows marks out of 4', await exec(`return /\\d \\/ 4/.test(document.querySelector('.slip').textContent);`));
  check('the slip names the candidate', await exec(`return document.querySelector('.slip').textContent.includes('Chidi Eze');`));
  await layoutOK('the result slip');

  // The lecturer unlocks the class report.
  await go(`${courseHash}/results`);
  await waitFor(`document.body.textContent.includes('Unlock the class report')`, 'the report paywall');
  await clickText('Unlock the class report');
  await waitFor(`document.body.textContent.includes('Test checkout')`, 'the test checkout');
  await clickText('Pay (test');
  await waitFor(`document.body.textContent.includes('Payment confirmed')`, 'payment confirmation');
  await clickText('Continue');
  await waitFor(`document.body.textContent.includes('class report')`, 'the class report');
  check('the class report lists the candidate', await exec(`return document.body.textContent.includes('2019/100001');`));
  await layoutOK('the class report');
} catch (e) {
  check('the flow ran to the end', false, e.message);
  try { console.log((await exec('return document.body.innerText;')).slice(0, 1500)); } catch { /* ignore */ }
} finally {
  await call('DELETE', `/session/${sid}`).catch(() => {});
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
