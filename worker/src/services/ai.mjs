// The model behind generation, re-solving, transcription and AI assist (brief §2.3, §3.6).
//
// claudeAI(client) wraps an @anthropic-ai/sdk client, which the platform entry constructs only
// when ANTHROPIC_API_KEY exists, so this module never imports the SDK itself (the browser demo
// has no SDK). fakeAI() is deterministic: it writes fill-in-the-blank questions from sentences of
// the selected text, which therefore pass the grounding check. Both share one interface:
//   generate({ text, count, tier, courseTitle }) -> { questions, usage }
//   resolve({ text, questions })                  -> { answers, usage }
//   transcribe({ base64, mediaType })             -> { text, printedPage, usage }
//   assist({ text })                              -> { questions, usage }
// Generated questions: { type, stem, options: [text], key: text, explanation, difficulty, page, quote }.

import { sha256 } from '../../../shared/sha256.mjs';

export const DEFAULT_MODEL = 'claude-opus-5';
// US dollars per million tokens; cache reads ~0.1x and writes ~1.25x of input.
const PRICES = { 'claude-opus-5': { in: 5, out: 25 }, 'claude-sonnet-5': { in: 2, out: 10 }, 'claude-haiku-4-5': { in: 1, out: 5 } };

export function costUSD(model, usage) {
  const p = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  const input = (usage.input_tokens ?? 0) + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0);
  return (input * p.in + (usage.output_tokens ?? 0) * p.out) / 1e6;
}

const GENERATION_RULES = `You write continuous-assessment questions from a lecturer's own notes.
Rules:
- Every question must be answerable from the notes alone.
- Test understanding and application, not page trivia.
- Each question has exactly one defensible answer.
- Draw distractors from the notes' own concepts; never make them absurd.
- Never write "according to the notes" or similar phrasing.
- Numerical questions use the notes' own formulas, with values you compute yourself.
- For each question give the page number shown in the notes' [page n] markers, and quote, word for word,
  a sentence of at least five words from that page that supports the answer.
- If the notes cannot support the number of questions requested without repetition or trivia, write fewer.
- For multiple choice, give 4 options and put the exact text of the correct option in "key".
- For true/false, "key" is "true" or "false". For numerical, "key" is the number and "tolerance" the absolute tolerance.`;

const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'stem', 'options', 'key', 'explanation', 'difficulty', 'page', 'quote'],
  properties: {
    type: { type: 'string', enum: ['mcq', 'tf', 'numeric', 'short'] },
    stem: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    key: { type: 'string' },
    tolerance: { type: 'number' },
    explanation: { type: 'string' },
    difficulty: { type: 'integer', enum: [1, 2, 3] },
    page: { type: 'integer' },
    quote: { type: 'string' },
  },
};
const GENERATE_SCHEMA = { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', items: QUESTION_SCHEMA } } };
const RESOLVE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answers'],
  properties: { answers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['index', 'answer'], properties: { index: { type: 'integer' }, answer: { type: 'string' } } } } },
};
const TRANSCRIBE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['text', 'printed_page'],
  properties: { text: { type: 'string' }, printed_page: { anyOf: [{ type: 'integer' }, { type: 'null' }] } },
};

export function claudeAI(client, { model = DEFAULT_MODEL } = {}) {
  async function call({ system, content, schema, maxTokens = 64000 }) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema } },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      const e = new Error(`the model declined (${msg.stop_details?.category ?? 'no category'})`);
      e.status = 422;
      throw e;
    }
    if (msg.stop_reason === 'max_tokens') throw new Error('the model ran out of room; select fewer pages or fewer questions');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { data: JSON.parse(text), usage: { model: msg.model ?? model, ...msg.usage } };
  }
  const notesBlock = (text) => ({ type: 'text', text: `<notes>\n${text}\n</notes>`, cache_control: { type: 'ephemeral' } });
  return {
    name: 'claude',
    model,
    async generate({ text, count, tier, courseTitle }) {
      const { data, usage } = await call({
        system: GENERATION_RULES,
        schema: GENERATE_SCHEMA,
        content: [notesBlock(text), { type: 'text', text: `Course: ${courseTitle} (${tier}). Write ${count} questions.` }],
      });
      return { questions: data.questions, usage };
    },
    async resolve({ text, questions }) {
      const list = questions.map((q, i) => `${i}. [${q.type}] ${q.stem}${q.options?.length ? '\n' + q.options.map((o) => `   - ${o}`).join('\n') : ''}`).join('\n');
      const { data, usage } = await call({
        system: 'Answer each question using only the notes. For multiple choice, reply with the exact text of the option you choose; for true/false, "true" or "false"; for numerical, the number.',
        schema: RESOLVE_SCHEMA,
        content: [notesBlock(text), { type: 'text', text: list }],
        maxTokens: 32000,
      });
      return { answers: data.answers, usage };
    },
    async transcribe({ base64, mediaType }) {
      const { data, usage } = await call({
        system: 'Transcribe the photographed or scanned page of lecture notes exactly. Keep headings (as Markdown #), lists and paragraphs; write formulas in TeX between $ signs; write [illegible] where the handwriting cannot be read. Report the printed page number if one is visible, else null.',
        schema: TRANSCRIBE_SCHEMA,
        content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }, { type: 'text', text: 'Transcribe this page.' }],
        maxTokens: 16000,
      });
      return { text: data.text, printedPage: data.printed_page, usage };
    },
    async assist({ text }) {
      const { data, usage } = await call({
        system: `${GENERATION_RULES}\nThe text below is the lecturer's own questions. Recover each question as written; add a key where it is missing (solve it), and an explanation. Do not invent new questions. Use page 0 and the question itself as the quote.`,
        schema: GENERATE_SCHEMA,
        content: [{ type: 'text', text }],
      });
      return { questions: data.questions, usage };
    },
  };
}

// ---------------------------------------------------------------- fake

const STOP = new Set(('about above after again against because before being below between both could during each from further ' +
  'having into itself more most other over same should some such than that their them then there these they this those through ' +
  'under until very what when where which while with would your which whose whom shall must might also only once upon within without').split(' '));

function sentencesOf(text) {
  const out = [];
  let page = null;
  for (const block of text.split(/\n(?=\[page \d+\])/)) {
    const m = /^\[page (\d+)\]\n?/.exec(block);
    if (m) page = Number(m[1]);
    const body = m ? block.slice(m[0].length) : block;
    for (const s of body.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"“(])/)) {
      const t = s.trim();
      const n = t.split(/\s+/).length;
      if (n >= 8 && n <= 45 && /[.!?]$/.test(t) && !/^#/.test(t)) out.push({ page, text: t });
    }
  }
  return out;
}

const keyWords = (s) => [...new Set((s.match(/\p{L}{6,}/gu) ?? []).filter((w) => !STOP.has(w.toLowerCase())))];
const pick = (seed, n) => sha256(seed)[0] % n;

export function fakeAI({ disagreeEvery = 0 } = {}) {
  const usage = () => ({ model: 'fake', input_tokens: 0, output_tokens: 0 });
  return {
    name: 'fake',
    model: 'fake',
    async generate({ text, count }) {
      const sentences = sentencesOf(text);
      const vocabulary = [...new Set(sentences.flatMap((s) => keyWords(s.text)))];
      const questions = [];
      for (const s of sentences) {
        if (questions.length >= count) break;
        const words = keyWords(s.text);
        if (!words.length) continue;
        const key = words[pick(s.text, words.length)];
        const distractors = vocabulary.filter((w) => w.toLowerCase() !== key.toLowerCase() && !s.text.includes(w));
        if (distractors.length < 3) continue;
        const start = pick(`${s.text}:d`, distractors.length);
        const options = [key, ...[0, 1, 2].map((i) => distractors[(start + i * 7) % distractors.length])];
        if (new Set(options.map((o) => o.toLowerCase())).size < 4) continue;
        const rot = pick(`${s.text}:r`, 4);
        questions.push({
          type: 'mcq',
          stem: `Fill in the blank: ${s.text.replace(key, '_____')}`,
          options: [...options.slice(rot), ...options.slice(0, rot)],
          key,
          explanation: `The text reads: "${s.text}"`,
          difficulty: 1,
          page: s.page,
          quote: s.text,
        });
      }
      return { questions, usage: usage() };
    },
    async resolve({ text, questions }) {
      const flat = text.replace(/\s+/g, ' ');
      const answers = questions.map((q, index) => {
        let answer = q.options?.find((o) => flat.includes(q.stem.replace(/^Fill in the blank: /, '').replace('_____', o))) ?? q.options?.[0] ?? '';
        if (disagreeEvery && (index + 1) % disagreeEvery === 0) answer = q.options.find((o) => o !== answer) ?? answer;
        return { index, answer };
      });
      return { answers, usage: usage() };
    },
    async transcribe() {
      return {
        text: '[Demo transcript] In the live system the model types out this page here. Replace this text with the page\'s words, then confirm.',
        printedPage: null,
        usage: usage(),
      };
    },
    async assist({ text }) {
      // The fake cannot solve questions: it recovers numbered questions and leaves keys for the lecturer.
      const { parseNumbered } = await import('../../../shared/parse/numbered.mjs');
      const { questions, errors } = parseNumbered(text);
      const drafts = [...questions, ...errors.map((e) => e.draft).filter(Boolean)].map((q) => ({
        type: 'mcq', stem: q.stem, options: q.options.map((o) => o.text),
        key: q.options.find((o) => o.id === q.key)?.text ?? q.options[0]?.text ?? '', explanation: '', difficulty: 2, page: 0, quote: q.stem,
      }));
      return { questions: drafts, usage: usage() };
    },
  };
}
