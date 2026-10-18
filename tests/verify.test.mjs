import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLecturerEmail, hostedDomainMatches } from '../shared/email-rules.mjs';
import { matchNames } from '../shared/names.mjs';

const listed = new Set(['unn.edu.ng', 'unilag.edu.ng', 'ox.ac.uk']);
const opts = { isListedDomain: (d) => listed.has(d) };

test('Level 1 accepts staff addresses at listed or .edu.ng domains', () => {
  for (const a of ['firstname.lastname@unn.edu.ng', 'john.doe2@unn.edu.ng', 'staff1990@unn.edu.ng', 'lecturer@fedpoly.edu.ng', 'a.b@eng.ox.ac.uk']) {
    assert.equal(classifyLecturerEmail(a, opts).ok, true, a);
  }
  assert.equal(classifyLecturerEmail('a.b@eng.ox.ac.uk', opts).institutionDomain, 'ox.ac.uk');
});

test('Level 1 refuses student, personal, unknown and blocked addresses', () => {
  const cases = {
    '2019123456@unn.edu.ng': /registration number/,
    'chinedu.2019245678@unn.edu.ng': /registration number/,
    'c.okafor.2019.245678@unn.edu.ng': /registration number/,
    'a.2020_123@unn.edu.ng': /registration number/,
    'a.b@student.unilag.edu.ng': /student addresses/,
    'x@gmail.com': /personal addresses/,
    'x@example.com': /not a recognized/,
    'not-an-address': /not an email/,
  };
  for (const [a, re] of Object.entries(cases)) assert.match(classifyLecturerEmail(a, opts).reason, re, a);
  assert.match(classifyLecturerEmail('x@unn.edu.ng', { ...opts, blockedDomains: ['unn.edu.ng'] }).reason, /not accepted/);
  assert.match(classifyLecturerEmail('s123@unn.edu.ng', { ...opts, studentPatterns: { 'unn.edu.ng': '^s\\d+' } }).reason, /student/);
});

test("Google's hd claim must be the address's domain or a parent of it", () => {
  assert.ok(hostedDomainMatches('unn.edu.ng', 'unn.edu.ng'));
  assert.ok(hostedDomainMatches('unn.edu.ng', 'mech.unn.edu.ng'));
  assert.ok(!hostedDomainMatches(undefined, 'unn.edu.ng'));
  assert.ok(!hostedDomainMatches('gmail.com', 'unn.edu.ng'));
});

test('name match: pass, admin review, fail — order-insensitive', () => {
  assert.equal(matchNames('Ada N. Obi', 'Adaeze Ngozi Obi'), 'pass');
  assert.equal(matchNames('Emeka Obi', 'Chukwuemeka Obi'), 'review');
  assert.equal(matchNames('Ada Okafor', 'Adaeze Obi'), 'fail');
  assert.equal(matchNames('Ngozi Adaeze Obi', 'OBI ADAEZE NGOZI'), 'pass'); // surname first, as NIMC prints it
  assert.equal(matchNames('Chidi Eze-Okafor', 'Chidi Eze Okafor'), 'pass'); // hyphenated surnames split
});
