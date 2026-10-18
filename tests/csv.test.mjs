import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, cell } from '../shared/csv.mjs';

test('BOM, CRLF and RFC 4180 quoting', () => {
  const out = toCSV(
    [{ key: 'name', header: 'Full name' }, { key: 'score', header: 'Score' }],
    [{ name: 'Obi, Ada "Nne"', score: 17 }, { name: 'Line\nbreak', score: 0 }],
  );
  assert.ok(out.startsWith('﻿'));
  assert.equal(out, '﻿Full name,Score\r\n"Obi, Ada ""Nne""",17\r\n"Line\nbreak",0\r\n');
});

test('cells a spreadsheet could read as a formula get a leading apostrophe', () => {
  assert.equal(cell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(cell('+2348000000000'), "'+2348000000000");
  assert.equal(cell('@cmd'), "'@cmd");
  assert.equal(cell('-x'), "'-x");
  assert.equal(cell('\tTAB'), "'\tTAB");
  assert.equal(cell('-12.5'), '-12.5'); // a plain number stays a number
  assert.equal(cell(null), '');
});
