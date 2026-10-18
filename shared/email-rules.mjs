// Level 1 of lecturer verification (brief §5.6): an institutional address at a university
// or other higher-education institution, never a student address.

const CONSUMER = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com',
  'gmx.com', 'gmx.net', 'yandex.com', 'zoho.com',
]);
const STUDENT_LABELS = new Set(['student', 'students', 'stu', 'std', 'alumni', 'alumnus', 'learner', 'learners']);
// A year 1900-2099 followed (with or without a separator) by three or more digits, or six digits in a row.
export const REG_NUMBER = /(?:19|20)\d{2}[._\-/]?\d{3,}|\d{6,}/;

/** The domain and each of its parents: a.b.unn.edu.ng -> [a.b.unn.edu.ng, b.unn.edu.ng, unn.edu.ng, edu.ng, ng]. */
export function domainChain(domain) {
  const labels = domain.split('.');
  return labels.map((_, i) => labels.slice(i).join('.'));
}

/**
 * options: { isListedDomain(d) -> bool, extraDomains: [], blockedDomains: [], studentPatterns: { domain: regexSource } }
 * Returns { ok: true, domain, institutionDomain } or { ok: false, reason, domain?, student? }.
 */
export function classifyLecturerEmail(address, options = {}) {
  const { isListedDomain = () => false, extraDomains = [], blockedDomains = [], studentPatterns = {} } = options;
  const a = String(address ?? '').trim().toLowerCase();
  const m = /^([^@\s]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(a);
  if (!m) return { ok: false, reason: 'not an email address' };
  const [, local, domain] = m;
  const chain = domainChain(domain);
  if (CONSUMER.has(domain)) {
    return { ok: false, domain, reason: "personal addresses are not accepted; use your institution's address" };
  }
  if (chain.some((d) => blockedDomains.includes(d))) return { ok: false, domain, reason: 'this domain is not accepted' };
  const institutionDomain = chain.find((d) => extraDomains.includes(d) || isListedDomain(d)) ?? (domain.endsWith('.edu.ng') ? domain : null);
  if (!institutionDomain) {
    return { ok: false, domain, reason: 'not a recognized university or higher-education domain; you can ask the administrator to review it' };
  }
  if (domain.split('.').some((l) => STUDENT_LABELS.has(l))) return { ok: false, domain, student: true, reason: 'student addresses are not accepted' };
  if (REG_NUMBER.test(local)) {
    return { ok: false, domain, student: true, reason: 'this looks like a student address: it contains a registration number' };
  }
  for (const [d, pattern] of Object.entries(studentPatterns)) {
    if (chain.includes(d) && new RegExp(pattern, 'i').test(local)) return { ok: false, domain, student: true, reason: 'student addresses are not accepted' };
  }
  return { ok: true, domain, institutionDomain };
}

/** Google's `hd` claim must be the address's domain or one of its parents. */
export function hostedDomainMatches(hd, emailDomain) {
  return !!hd && domainChain(String(emailDomain).toLowerCase()).includes(String(hd).toLowerCase());
}
