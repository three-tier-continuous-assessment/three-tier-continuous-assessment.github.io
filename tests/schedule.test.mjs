import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSchedule, parsePageRange } from '../shared/parse/schedule.mjs';

test('page ranges, including half pages', () => {
  assert.deepEqual(parsePageRange('Pages 3-7'), { from: 3, to: 7 });
  assert.deepEqual(parsePageRange('pp. 20–21'), { from: 20, to: 21 });
  assert.deepEqual(parsePageRange('Page 15 (second half)-17'), { from: 15, to: 17, fromPart: 'second-half' });
  assert.deepEqual(parsePageRange('p. 12'), { from: 12, to: 12 });
  assert.deepEqual(parsePageRange('30 to 34'), { from: 30, to: 34 });
  assert.deepEqual(parsePageRange('pp. 5-9 (first half)'), { from: 5, to: 9, toPart: 'first-half' });
  assert.equal(parsePageRange('Pages 10-6'), null);
  assert.equal(parsePageRange('Offer and Acceptance'), null);
});

test('a laid-out table with wrapped cells parses into rows', () => {
  const text = readFileSync(new URL('./fixtures/schedule-layout.txt', import.meta.url), 'utf8');
  const { rows, format } = parseSchedule(text);
  assert.equal(format, 'layout');
  assert.deepEqual(rows.map((r) => r.label), ['CA1', 'CA2', 'CA3', 'CA4']);
  assert.equal(rows[1].topic, 'The Zeroth Law and Temperature Scales of Measurement');
  assert.deepEqual(rows[2].range, { from: 15, to: 17, fromPart: 'second-half' });
  assert.equal(rows[2].topic, 'Work and Heat Transfer');
});

test('CSV and one-row-per-line schedules', () => {
  const csv = parseSchedule('CA,Pages,Topic\nCA1,3-7,Systems and Properties\nCA2,"9-12",Temperature Scales\n');
  assert.equal(csv.format, 'csv');
  assert.deepEqual(csv.rows[1], { label: 'CA2', pagesText: '9-12', range: { from: 9, to: 12 }, topic: 'Temperature Scales' });
  const lines = parseSchedule('CA1 pp. 3-7 Systems and Properties\nCA3: p. 15 (second half)–17 Work and Heat Transfer\nnot a row');
  assert.equal(lines.format, 'lines');
  assert.equal(lines.rows.length, 2);
  assert.deepEqual(lines.rows[1].range, { from: 15, to: 17, fromPart: 'second-half' });
  assert.equal(lines.rows[1].topic, 'Work and Heat Transfer');
});
