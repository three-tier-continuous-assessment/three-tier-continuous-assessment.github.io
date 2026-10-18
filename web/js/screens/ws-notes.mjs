// Notes (brief §2.1, §2.2): send notes from the phone (camera or files), check transcripts beside
// the photos, number pages as printed, choose the pages a quiz covers, and import a CA schedule.

import { h, field, note, toast, busy } from '../dom.mjs';
import { api, store } from '../api.mjs';
import { extractFile, kindOf, pdfLayoutText } from '../extract.mjs';
import { timingFields, pagesSpec } from '../ui.mjs';

export default async function notesTab(root, { course, token }) {
  const call = (m, p, b) => api(m, p, b, token);
  const list = h('div'), adder = h('div'), chooser = h('div'), schedule = h('div');
  root.append(
    h('h2', { text: course.tier === 'tertiary' ? 'Lecture notes' : 'Lesson notes' }), list,
    h('h2', { text: 'Add notes' }), adder,
    h('h2', { text: 'Choose pages for a quiz' }), chooser,
    h('h2', { text: 'CA schedule' }), schedule,
  );
  renderAdder();
  renderSchedule();
  await refresh();

  async function refresh() {
    const r = await call('GET', `/api/courses/${course.id}/notes`);
    const files = r.data.files ?? [];
    const numberOf = new Map((r.data.numbers ?? []).map((n) => [`${n.file}:${n.index}`, n.number]));
    list.replaceChildren();
    if (r.data.warnings?.length) list.append(note(`Page numbers clash: ${r.data.warnings.join('; ')}`, 'warn'));
    if (!files.length) list.append(note('No notes yet. Add photos, scans, PDF or Word files below.'));
    for (const f of files) {
      const nums = f.pages.map((p) => numberOf.get(`${f.id}:${p.idx}`));
      const first = h('input', { type: 'number', min: 1, inputmode: 'numeric', value: f.first_page });
      const unchecked = f.pages.filter((p) => !p.confirmed).length;
      const saveFirst = h('button', { text: 'Save numbering' });
      saveFirst.onclick = busy(saveFirst, async () => { await call('PUT', `/api/notes/${f.id}`, { first_page: Number(first.value) }); toast('Page numbering saved'); refresh(); });
      const del = h('button', { class: 'danger', text: 'Delete file' });
      del.onclick = async () => {
        if (!confirm(`Delete "${f.name}"?`)) return;
        const retire = confirm('Also retire the questions written from this file?\nOK: retire them.  Cancel: keep them.');
        await call('DELETE', `/api/notes/${f.id}${retire ? '?with_questions=1' : ''}`);
        refresh();
      };
      list.append(h('div', { class: 'card' },
        h('strong', { text: f.name }),
        h('div', { class: 'small muted', text: `${f.kind.toUpperCase()} · ${f.pages.length} page${f.pages.length === 1 ? '' : 's'} · numbered ${nums[0]}–${nums[nums.length - 1]}` }),
        unchecked ? note(`${unchecked} transcribed page(s) not yet checked`, 'warn') : null,
        h('div', { class: 'row' }, field('First page number', first, 'Set this when the file continues an earlier one, e.g. Lecture 2 starting at page 11.'), h('div', { class: 'shrink' }, saveFirst)),
        h('details', {}, h('summary', { text: 'Show and correct pages' }), ...f.pages.map((p) => pageEditor(f, p, numberOf.get(`${f.id}:${p.idx}`)))),
        h('div', { style: { marginTop: '8px' } }, del)));
    }
    renderChooser(files.length > 0);
  }

  function pageEditor(f, p, number) {
    const ta = h('textarea', { value: p.text, 'aria-label': `Text of page ${number}` });
    const save = h('button', { text: p.confirmed ? 'Save page' : 'Save and mark checked' });
    save.onclick = busy(save, async () => {
      const r = await call('PUT', `/api/notes/${f.id}/pages/${p.idx}`, { text: ta.value, confirmed: true });
      toast(r.status === 200 ? 'Page saved' : r.data.error);
    });
    return h('div', { class: 'card' }, h('div', { class: 'small muted', text: `Page ${number}${p.transcribed ? ' · transcribed' : ''}${p.confirmed ? '' : ' · not yet checked'}` }), ta, save);
  }

  // ------------------------------------------------------------ adding notes

  function renderAdder() {
    const rights = h('input', { type: 'checkbox' });
    const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, class: 'hidden' });
    const picker = h('input', { type: 'file', accept: '.pdf,.docx,.tex,.md,.markdown,.txt,image/*,application/pdf', multiple: true, class: 'hidden' });
    const staging = h('div');
    let staged = [];
    let photos = null; // the current photo batch, one staged "file"
    const status = h('div', { class: 'small muted', 'aria-live': 'polite' });

    async function take(fileList) {
      for (const file of fileList) {
        try {
          status.textContent = `Reading ${file.name}…`;
          const kind = kindOf(file);
          const x = await extractFile(file, (m) => { status.textContent = `${file.name}: ${m}`; });
          if (kind === 'photo') {
            if (!photos) { photos = { name: `Photos ${new Date().toLocaleDateString()}`, kind: 'photo', firstPage: 1, pages: [] }; staged.push(photos); }
            photos.pages.push(...x.pages);
          } else {
            staged.push({ name: x.name.replace(/\.[^.]+$/, ''), kind: x.kind, firstPage: x.pages[0]?.printed ?? 1, pages: x.pages });
          }
        } catch (e) {
          toast(e.message, 6000);
        }
      }
      status.textContent = '';
      draw();
    }
    camera.onchange = () => { take([...camera.files]); camera.value = ''; };
    picker.onchange = () => { take([...picker.files]); picker.value = ''; };

    function draw() {
      staging.replaceChildren();
      staged.forEach((s, si) => {
        const name = h('input', { value: s.name });
        name.oninput = () => { s.name = name.value; };
        const first = h('input', { type: 'number', min: 1, value: s.firstPage, inputmode: 'numeric' });
        first.oninput = () => { s.firstPage = Number(first.value) || 1; };
        const needs = s.pages.filter((p) => p.image && !p.text.trim()).length;
        const tx = h('button', { class: needs ? 'primary' : '', text: `Transcribe ${needs} page(s)` });
        tx.disabled = !needs;
        tx.onclick = busy(tx, async () => {
          let done = 0;
          for (const p of s.pages) {
            if (!p.image || p.text.trim()) continue;
            tx.textContent = `Transcribing ${++done} of ${needs}…`;
            const r = await call('POST', '/api/transcribe', { image: p.image.base64, media_type: 'image/jpeg' });
            if (r.status !== 200) { toast(r.data.error ?? 'Transcription failed', 6000); break; }
            p.text = r.data.text;
            if (Number.isInteger(r.data.printed)) p.printed = r.data.printed;
          }
          draw();
        });
        const save = h('button', { class: 'primary', text: 'Save to this course' });
        save.onclick = busy(save, async () => {
          if (!rights.checked) { toast('Please confirm that you may use this material'); rights.focus(); return; }
          if (s.pages.some((p) => !p.text.trim())) { toast('Every page needs text: transcribe the photos first, or type the text'); return; }
          const r = await call('POST', `/api/courses/${course.id}/notes`, {
            name: s.name, kind: s.kind, first_page: s.firstPage, rights: true,
            pages: s.pages.map((p) => ({ text: p.text, printed: p.printed, transcribed: !!p.image, confirmed: true })),
          });
          if (r.status !== 201) { toast(r.data.error ?? 'Could not save', 6000); return; }
          s.pages.forEach((p) => p.image?.url && URL.revokeObjectURL(p.image.url));
          staged = staged.filter((x) => x !== s);
          if (photos === s) photos = null;
          toast(`Saved ${r.data.pages} page(s)`);
          draw();
          refresh();
        });
        staging.append(h('div', { class: 'card' },
          h('div', { class: 'row' }, field('File name', name), field('First page number', first)),
          h('div', { class: 'pages', style: { marginTop: '10px' } }, s.pages.map((p, pi) => stagedPage(s, p, pi))),
          h('div', { class: 'row', style: { marginTop: '10px' } }, s.pages.some((p) => p.image) ? tx : null, save,
            h('button', { onclick: () => { staged.splice(si, 1); if (photos === s) photos = null; draw(); }, text: 'Discard' }))));
      });
    }

    function stagedPage(s, p, pi) {
      const ta = h('textarea', { value: p.text, placeholder: p.image ? 'Not transcribed yet' : '', 'aria-label': `Page ${pi + 1} text` });
      ta.oninput = () => { p.text = ta.value; };
      const move = (d) => () => {
        const j = pi + d;
        if (j < 0 || j >= s.pages.length) return;
        [s.pages[pi], s.pages[j]] = [s.pages[j], s.pages[pi]];
        draw();
      };
      return h('div', { class: 'thumb' },
        p.image ? h('img', { src: p.image.url, alt: `Page ${pi + 1}`, loading: 'lazy' }) : null,
        h('div', { class: 'small muted', text: `Page ${s.firstPage + pi}${Number.isInteger(p.printed) ? ` (printed ${p.printed})` : ''}` }),
        ta,
        s.kind === 'photo' ? h('div', { class: 'row' },
          h('button', { onclick: move(-1), 'aria-label': 'Move earlier', text: '↑' }),
          h('button', { onclick: move(1), 'aria-label': 'Move later', text: '↓' }),
          h('button', { onclick: () => { s.pages.splice(pi, 1); draw(); }, 'aria-label': 'Remove page', text: '✕' })) : null);
    }

    adder.append(h('div', { class: 'card' },
      h('p', { text: 'Photograph handwritten or typed pages, or choose CamScanner exports, PDF, Word, LaTeX, Markdown or text files.' }),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => camera.click(), text: 'Take photo' }),
        h('button', { onclick: () => picker.click(), text: 'Choose files' })),
      camera, picker, status,
      h('label', { class: 'check' }, rights, h('span', { text: 'I have the right to use this material for my students’ assessment.' })),
      h('p', { class: 'small muted', text: 'Photos and scans are sent to the AI model only to be typed out. The original files are not kept: only the text of each page.' })),
    staging);
  }

  // ------------------------------------------------------------ choosing pages

  function renderChooser(hasNotes) {
    chooser.replaceChildren();
    if (!hasNotes) { chooser.append(note('Add notes first.')); return; }
    const from = h('input', { type: 'number', min: 1, inputmode: 'numeric' });
    const to = h('input', { type: 'number', min: 1, inputmode: 'numeric' });
    const second = h('input', { type: 'checkbox' });
    const firstHalf = h('input', { type: 'checkbox' });
    const sa = h('input', { placeholder: 'optional: first words of the first paragraph' });
    const ea = h('input', { placeholder: 'optional: first words of the last paragraph' });
    const out = h('div');
    const spec = () => pagesSpec({ from: from.value, to: to.value || from.value, secondHalf: second.checked, firstHalf: firstHalf.checked, startAnchor: sa.value.trim(), endAnchor: ea.value.trim() });
    const preview = h('button', { text: 'Preview the selected text' });
    preview.onclick = busy(preview, async () => {
      const r = await call('POST', `/api/courses/${course.id}/preview`, { spec: spec() });
      if (r.status !== 200) { out.replaceChildren(note(r.data.error, 'bad')); return; }
      out.replaceChildren(h('p', { class: 'small muted', text: `${r.data.words} words` }),
        h('div', { class: 'preview' }, r.data.segments.map((s) => h('div', {}, h('strong', { text: `[page ${s.number}]` }), '\n', s.text, '\n\n'))));
    });
    const timing = timingFields(course.tier);
    const title = h('input', { placeholder: 'e.g. CA3: Work and heat transfer' });
    const create = h('button', { class: 'primary', text: 'Create a quiz from these pages' });
    create.onclick = busy(create, async () => {
      if (!from.value) { toast('Give the first page'); from.focus(); return; }
      const t = timing.get();
      const r = await call('POST', '/api/quizzes', { course_id: course.id, title: title.value.trim() || `Pages ${from.value}–${to.value || from.value}`, selection: spec(), ...t });
      if (r.status !== 201) { toast(r.data.error ?? 'Could not create the quiz', 6000); return; }
      store.set('quiz.selected', r.data.id);
      location.hash = `#/w/${course.id}/quizzes`;
    });
    chooser.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, field('From page', from), field('To page', to)),
      h('label', { class: 'check' }, second, h('span', { text: 'Start at the second half of the first page' })),
      h('label', { class: 'check' }, firstHalf, h('span', { text: 'End at the first half of the last page' })),
      field('Start at the paragraph beginning', sa), field('End with the paragraph beginning', ea),
      h('div', { style: { marginTop: '10px' } }, preview), out,
      h('h3', { text: 'Quiz from these pages' }), field('Quiz title', title), timing.el,
      h('div', { style: { marginTop: '10px' } }, create)));
  }

  // ------------------------------------------------------------ CA schedule

  function renderSchedule() {
    const text = h('textarea', { placeholder: 'Paste or type rows, e.g.\nCA1  Pages 6-10  Offer and Acceptance\nCA2  Pages 13-16  Consideration\n\nor CSV: CA,Pages,Topic' });
    const upload = h('input', { type: 'file', accept: '.csv,.txt,.pdf,text/plain,text/csv,application/pdf', class: 'hidden' });
    upload.onchange = async () => {
      const f = upload.files[0];
      if (!f) return;
      text.value = f.name.toLowerCase().endsWith('.pdf') ? await pdfLayoutText(f) : await f.text();
      upload.value = '';
    };
    const timing = timingFields(course.tier);
    const out = h('div');
    const go = h('button', { class: 'primary', text: 'Create one quiz per row' });
    go.onclick = busy(go, async () => {
      const r = await call('POST', `/api/courses/${course.id}/schedule`, { text: text.value, ...timing.get() });
      if (r.status !== 201) { out.replaceChildren(note(r.data.error ?? 'Could not read the schedule', 'bad')); return; }
      out.replaceChildren(
        note(`Created ${r.data.created.length} quiz draft(s) from the schedule.`, r.data.created.length ? 'good' : 'warn'),
        r.data.skipped.length ? note(`Skipped: ${r.data.skipped.map((s) => `${s.label} (${s.reason})`).join('; ')}`, 'warn') : null,
        h('ul', {}, r.data.created.map((c) => h('li', { text: `${c.label}: ${c.topic} — pages ${c.selection.fromPart ? 'second half of ' : ''}${c.selection.from}–${c.selection.to}` }))),
        r.data.created.length ? h('a', { class: 'btn', href: `#/w/${course.id}/quizzes`, text: 'Go to Quizzes to generate questions' }) : null);
    });
    schedule.append(h('div', { class: 'card' },
      h('p', { text: 'A CA schedule lists each CA with its pages and topic, as on a CA material sheet. Each row becomes a quiz draft.' }),
      text,
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { onclick: () => upload.click(), text: 'Upload CSV, text or PDF' })),
      upload, timing.el, h('div', { style: { marginTop: '10px' } }, go), out));
  }
}
