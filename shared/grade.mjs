// Marking (brief §4.6). Pure functions over canonical answers: the Worker maps a
// displayed letter to the canonical option before calling these.

export const TYPES = Object.freeze(['mcq', 'tf', 'numeric', 'short']);

/** Normalizes a short answer: case, accents, surrounding punctuation, inner whitespace. */
export function normalizeShort(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!?'"()]+|[\s.,;:!?'"()]+$/g, '');
}

/** Parses a numeric answer, accepting a decimal comma and surrounding spaces. */
export function parseNumber(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : NaN;
  const t = String(s ?? '').trim().replace(/\s+/g, '').replace(/,(?=\d{1,2}$|\d+e)/i, '.');
  return /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

/**
 * Grades one answer. `answer` is null/undefined when unanswered; otherwise a canonical
 * option id (mcq), "true"/"false" (tf), a number or numeric string (numeric), or text.
 * Returns { answered, correct, marks }.
 */
export function gradeAnswer(question, answer) {
  const marks = question.marks ?? 1;
  if (answer === null || answer === undefined || answer === '') return { answered: false, correct: false, marks: 0 };
  let correct = false;
  switch (question.type) {
    case 'mcq':
      correct = answer === question.key;
      break;
    case 'tf':
      correct = String(answer).toLowerCase() === String(question.key).toLowerCase();
      break;
    case 'numeric': {
      const x = parseNumber(answer);
      const key = Number(question.key);
      if (Number.isFinite(x) && Number.isFinite(key)) {
        const tolAbs = question.tolerance?.abs ?? 0;
        const tolRel = question.tolerance?.rel ?? 0;
        const tol = Math.max(tolAbs, tolRel * Math.abs(key));
        correct = Math.abs(x - key) <= tol + 1e-12 * Math.max(1, Math.abs(key));
      }
      break;
    }
    case 'short': {
      const given = normalizeShort(answer);
      const accepted = [question.key, ...(question.accepted ?? [])].map(normalizeShort);
      correct = given !== '' && accepted.includes(given);
      break;
    }
    default:
      throw new Error(`gradeAnswer: unknown type ${question.type}`);
  }
  return { answered: true, correct, marks: correct ? marks : 0 };
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Grades an attempt. `questions` is the sitting's question list; `answers` maps
 * question id -> canonical answer. Returns counts, score, maximum and percentage.
 */
export function gradeAttempt(questions, answers) {
  let attempted = 0, correct = 0, score = 0, max = 0;
  const items = [];
  for (const q of questions) {
    max += q.marks ?? 1;
    const g = gradeAnswer(q, answers[q.id]);
    if (g.answered) attempted++;
    if (g.correct) correct++;
    score += g.marks;
    items.push({ id: q.id, ...g });
  }
  return {
    attempted,
    correct,
    wrong: attempted - correct,
    unanswered: questions.length - attempted,
    score,
    max,
    percent: max ? round2((100 * score) / max) : 0,
    items,
  };
}

export function scaled(score, max, scaleTo) {
  if (!scaleTo || !max) return null;
  return round2((score / max) * scaleTo);
}

/** Band presets: [lower bound (percent), label] in descending order. */
export const BAND_PRESETS = Object.freeze({
  none: [],
  'ng-university': [[70, 'A'], [60, 'B'], [50, 'C'], [45, 'D'], [40, 'E'], [0, 'F']],
  waec: [[75, 'A1'], [70, 'B2'], [65, 'B3'], [60, 'C4'], [55, 'C5'], [50, 'C6'], [45, 'D7'], [40, 'E8'], [0, 'F9']],
});

export function grade(percent, bands) {
  for (const [lower, label] of bands ?? []) if (percent >= lower) return label;
  return null;
}

/**
 * Item analysis. `matrix` is one entry per candidate: { total, correct: Set(questionIds) }.
 * Returns, per question id, the proportion correct and the discrimination index
 * D = p(top 27%) - p(bottom 27%); a negative D suggests a mis-keyed question.
 */
export function itemAnalysis(questionIds, matrix) {
  const n = matrix.length;
  const sorted = [...matrix].sort((a, b) => b.total - a.total);
  const g = Math.max(1, Math.round(0.27 * n));
  const top = sorted.slice(0, g);
  const bottom = sorted.slice(-g);
  const share = (group, id) => group.filter((c) => c.correct.has(id)).length / group.length;
  const out = {};
  for (const id of questionIds) {
    const p = n ? matrix.filter((c) => c.correct.has(id)).length / n : 0;
    const d = n >= 2 ? share(top, id) - share(bottom, id) : 0;
    out[id] = { p: round2(p), d: round2(d), suspect: n >= 4 && d < 0 };
  }
  return out;
}
