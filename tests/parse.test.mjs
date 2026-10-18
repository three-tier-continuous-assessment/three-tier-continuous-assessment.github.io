import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiken } from '../shared/parse/aiken.mjs';
import { parseGIFT } from '../shared/parse/gift.mjs';
import { parseCSVPool } from '../shared/parse/csvpool.mjs';
import { parseNumbered } from '../shared/parse/numbered.mjs';
import { parsePool, detectFormat } from '../shared/parse/index.mjs';
import { gradeAnswer } from '../shared/grade.mjs';

const keyText = (q) => q.options.find((o) => o.id === q.key)?.text;

test('Aiken: questions, keys, fixed options, and errors with line numbers', () => {
  const src = `Which law defines temperature equality?
A. First law
B. Zeroth law
C. Second law
ANSWER: B

Which of these are state properties?
A) Pressure
B) Temperature
C) All of the above
ANSWER: C

A question with no answer
A. one
B. two

Wrong letter?
A. x
B. y
ANSWER: D`;
  const { questions, errors } = parseAiken(src);
  assert.equal(questions.length, 2);
  assert.equal(keyText(questions[0]), 'Zeroth law');
  assert.equal(questions[1].fixed_options, true);
  assert.equal(errors.length, 2);
  assert.match(errors.map((e) => e.message).join(' | '), /ANSWER/);
  assert.match(errors.map((e) => e.message).join(' | '), /key is not one of the options/);
});

test('GIFT: multiple choice, true/false, numeric, range, short answer, escapes; partial credit refused', () => {
  const src = `// a comment
::Q1:: The SI unit of heat is {=joule ~watt ~newton#not a force}

Heat flows spontaneously from hot to cold. {T}

What is 2 + 2? {#4:0}

g in m/s²? {#9.7..9.9}

Name the law of thermal equilibrium. {=zeroth law =the zeroth law}

Pick the escaped one {=a\\~b ~c}

Partial credit {~%50%x ~%50%y ~z}`;
  const { questions, errors } = parseGIFT(src);
  assert.equal(questions.length, 6);
  const [q1, q2, q3, q4, q5, q6] = questions;
  assert.equal(keyText(q1), 'joule');
  assert.equal(q2.type, 'tf');
  assert.equal(q2.key, 'true');
  assert.deepEqual([q3.type, q3.key, q3.tolerance.abs], ['numeric', 4, 0]);
  assert.equal(gradeAnswer(q4, '9.75').correct, true);
  assert.equal(gradeAnswer(q4, '9.95').correct, false);
  assert.equal(q5.type, 'short');
  assert.equal(gradeAnswer(q5, 'The Zeroth Law').correct, true);
  assert.equal(keyText(q6), 'a~b');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /partial-credit/);
});

test('CSV pool: letter keys, option-text keys, true/false, numeric, short with variants', () => {
  const src = `Question,A,B,C,D,Answer,Explanation
"Unit of work, in SI?",joule,watt,pascal,kelvin,A,Work is force times distance
Unit of power?,joule,watt,pascal,kelvin,watt,
Energy is conserved.,,,,,true,
Boiling point of water at 1 atm (°C)?,,,,,100,
Name the property that measures disorder.,,,,,entropy|the entropy,`;
  const { questions, errors } = parseCSVPool(src);
  assert.deepEqual(errors, []);
  assert.equal(questions.length, 5);
  assert.equal(keyText(questions[0]), 'joule');
  assert.equal(questions[0].explanation, 'Work is force times distance');
  assert.equal(keyText(questions[1]), 'watt');
  assert.equal(questions[2].type, 'tf');
  assert.equal(questions[3].type, 'numeric');
  assert.equal(gradeAnswer(questions[4], 'The Entropy').correct, true);
});

test('numbered papers: multi-line stems, inline options, (a) style, answer variants, and drafts for missing keys', () => {
  const src = `1. A closed system is one in which
mass cannot cross the boundary. Which quantity can cross it?
A. Mass only
B. Energy only
C. Both mass and energy
D. Neither
Answer: B

2) The unit of pressure is:  A. newton   B. pascal   C. joule   D. watt
Ans: b

Q3. Which is an intensive property?
(a) volume
(b) mass
(c) temperature
(d) energy
Correct answer - C

4. Which statement is true?
A. none
B. some`;
  const { questions, errors } = parseNumbered(src);
  assert.equal(questions.length, 3);
  assert.match(questions[0].stem, /closed system is one in which mass cannot cross/);
  assert.equal(keyText(questions[0]), 'Energy only');
  assert.equal(questions[1].options.length, 4);
  assert.equal(keyText(questions[1]), 'pascal');
  assert.equal(keyText(questions[2]), 'temperature');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].number, 4);
  assert.ok(errors[0].draft, 'an unkeyed question is kept as a draft for AI assist or the lecturer');
});

test('format detection', () => {
  assert.equal(detectFormat('Q {=a ~b}'), 'gift');
  assert.equal(detectFormat('Q\nA. x\nB. y\nANSWER: A'), 'aiken');
  assert.equal(detectFormat('Question,A,B,Answer\nx,1,2,A'), 'csv');
  assert.equal(detectFormat('1. x\nA. y\nB. z\nAnswer: A'), 'numbered');
  assert.equal(detectFormat('[{"stem":"x"}]'), 'json');
  assert.equal(parsePool('Q {=a ~b}').questions.length, 1);
});
