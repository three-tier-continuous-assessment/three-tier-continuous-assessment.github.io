import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberPages, paragraphs, detectHeadings, courseHeadings, resolveSelection, extractSelection } from '../shared/notes.mjs';

// FIXTURE: synthetic note pages, not teaching content.
const lecture1 = {
  id: 'f1', name: 'Lecture 1', firstPage: 1,
  pages: [
    { text: '# Systems\n\nA system is the part of the universe under study.\n\nThe surroundings are everything else.' },
    { text: '## Properties\n\nPressure and temperature are intensive.\n\nVolume and mass are extensive.' },
  ],
};
const lecture2 = {
  id: 'f2', name: 'Lecture 2', firstPage: 3, // continues the numbering of Lecture 1
  pages: [
    { text: '# Work\n\nWork is energy transferred by a force acting through a distance.\n\nSecond-half paragraph about boundary work, which needs a moving boundary.' },
    { text: 'Heat transfer is energy crossing the boundary because of a temperature difference.\n\n# Laws\n\nThe zeroth law defines thermal equilibrium.' },
  ],
};

test('pages are numbered across files, with printed numbers when known, and duplicates reported', () => {
  const { pages, warnings } = numberPages([lecture1, lecture2]);
  assert.deepEqual(pages.map((p) => p.number), [1, 2, 3, 4]);
  assert.match(pages[0].hash, /^[0-9a-f]{64}$/);
  const dup = numberPages([lecture1, { ...lecture2, firstPage: 2 }]);
  assert.equal(dup.warnings.length, 1);
  const printed = numberPages([{ id: 'p', name: 'photos', firstPage: 1, pages: [{ text: 'a', printed: 43 }, { text: 'b', printed: 44 }] }]);
  assert.deepEqual(printed.pages.map((p) => p.number), [43, 44]);
  assert.deepEqual(warnings, []);
});

test('paragraphs and headings', () => {
  const ps = paragraphs('First.\n\n  Second\nline.\n\n\nThird.');
  assert.deepEqual(ps.map((p) => p.text), ['First.', 'Second\nline.', 'Third.']);
  const hs = detectHeadings('# Systems\ntext\n2.3 Boundary Work\nTHE FIRST LAW\nAn ordinary sentence ends here.');
  assert.deepEqual(hs.map((h) => [h.level, h.title]), [[1, 'Systems'], [2, '2.3 Boundary Work'], [1, 'THE FIRST LAW']]);
});

test('page-range selections, with anchors and half pages', () => {
  const { pages } = numberPages([lecture1, lecture2]);
  const whole = resolveSelection(pages, { kind: 'pages', from: 2, to: 3 });
  assert.ok(whole.ok);
  const ex = extractSelection(pages, whole);
  assert.deepEqual(ex.segments.map((s) => s.number), [2, 3]);
  assert.match(ex.text, /^\[page 2\]\n## Properties/);

  const anchored = extractSelection(pages, resolveSelection(pages, { kind: 'pages', from: 1, to: 1, startAnchor: 'The surroundings' }));
  assert.equal(anchored.segments[0].text, 'The surroundings are everything else.');

  const ended = extractSelection(pages, resolveSelection(pages, { kind: 'pages', from: 3, to: 4, endAnchor: 'heat transfer is' }));
  assert.equal(ended.segments[1].text, 'Heat transfer is energy crossing the boundary because of a temperature difference.');

  const half = extractSelection(pages, resolveSelection(pages, { kind: 'pages', from: 3, to: 3, fromPart: 'second-half' }));
  assert.match(half.text, /^\[page 3\]\nSecond-half paragraph/);

  assert.match(resolveSelection(pages, { kind: 'pages', from: 9, to: 10 }).error, /page 9 is not in the notes/);
  assert.match(resolveSelection(pages, { kind: 'pages', from: 1, to: 1, startAnchor: 'nowhere' }).error, /no paragraph/);
});

test('heading selections run to the next heading of the same or higher level', () => {
  const { pages } = numberPages([lecture1, lecture2]);
  const hs = courseHeadings(pages);
  assert.deepEqual(hs.map((h) => h.title), ['Systems', 'Properties', 'Work', 'Laws']);
  const sel = resolveSelection(pages, { kind: 'headings', first: 2, last: 2 }); // "Work" only
  const ex = extractSelection(pages, sel);
  assert.deepEqual(ex.segments.map((s) => s.number), [3, 4]);
  assert.doesNotMatch(ex.text, /zeroth/);
  assert.match(ex.text, /Heat transfer is energy/);
});
