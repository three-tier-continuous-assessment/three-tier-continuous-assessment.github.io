# Three-Tier Continuous Assessment

Lecturers and teachers turn their own notes into timed continuous-assessment quizzes. Students sit them
free in a phone, tablet or desktop browser, and the result is ready seconds after the last question.
A student pays ₦100 to see their own result; a lecturer pays ₦500 for the class report (PDF and CSV).

- **Notes in.** Lecturers send photos of handwritten or typed pages, CamScanner scans, PDF, Word,
  LaTeX, Markdown or text, straight from the phone. Scans and photos are transcribed by the model and
  checked by the lecturer; pages keep their printed numbers.
- **Pages to quiz.** Choose page ranges, with anchors for partial pages, or import a CA schedule
  ("CA1 · Pages 6–10 · …"). The model drafts questions, each with a word-for-word quote from the
  chosen pages; quotes that are not on the page are discarded, and a second independent reading flags
  any disputed key. Nothing enters a quiz until the lecturer approves it.
- **Existing questions.** The Question Pool reads Aiken and GIFT (Moodle), CSV, JSON, and numbered
  papers, with no AI at all.
- **The sitting.** 15, 30, 45 or 60 minutes; 10, 15, 30 or 45 seconds per question (60 s for primary
  only). The server releases each question only during its slot and timestamps every answer, so the
  phone's clock changes nothing. Every seat gets a different question order, guaranteed by
  construction, and option orders are shuffled per candidate.
- **Results.** Graded the moment the last slot closes; unlocked through Paystack, verified on the
  server; slips print to PDF through the browser; the class report adds statistics, item analysis and a
  CSV with chosen columns.
- **Lecturer verification.** Level 1: an institutional email (never a student address). Gold
  Certified: Level 1 plus a research identity (ORCID, Google Scholar or Scopus) or a NIN.

## Run it

Requires Node 22.5 or later. Nothing to install for development or tests.

```sh
npm run dev                 # http://localhost:8790/ — real server, fake Google, Paystack, model and NIN
TTCA_MODE=demo npm run dev  # the browser demo: the server runs inside the page
npm test                    # unit and integration tests
npm run test:slow           # the ordering test at 100,000 seats
```

Browser suites (headless Firefox through geckodriver):

```sh
geckodriver --port 4444 &
MEMORY=1 npm run dev &
npm run smoke:mobile        # 360, 390 and 768 px: overflow, 44 px targets, 16 px inputs
npm run smoke:flow          # lecturer to candidate to payment to report, through the real interface
```

## Deploy

- **GitHub Pages** (`.github/workflows/pages.yml`) runs every test, then publishes `web/` with the
  modules it imports. Until the Worker exists, `web/config.js` sets `mode: 'demo'`, so the site runs
  the real server code in the visitor's browser and labels itself as a demo.
- **Cloudflare Worker** (`.github/workflows/worker.yml`, `wrangler.toml`): see
  [docs/PROGRESS.md](docs/PROGRESS.md) for the accounts and secrets it waits for. Then set
  `web/config.js` to `{ mode: 'live', api: '<worker URL>', googleClientId: '<client id>' }`.

## Layout

| Path | Contents |
|---|---|
| `shared/` | ordering, timing, marking, CSV, parsers, notes model, grounding, verification rules — used by the browser, the Worker and the tests |
| `worker/src/` | the request handler and its services (Google, Paystack, Claude, NIN) |
| `worker/migrations/` | the D1 schema |
| `web/` | the static site; `web/vendor/` holds pinned copies of pdf.js, mammoth, KaTeX and sql.js |
| `tools/` | development server, Node D1 adapter, browser suites, vendoring and domain-list scripts |
| `tests/` | `node --test` suites and synthetic fixtures |
| `docs/` | decisions, progress, security, costs |

## Documents

[DECISIONS](docs/DECISIONS.md) · [PROGRESS](docs/PROGRESS.md) · [SECURITY](docs/SECURITY.md) ·
[COSTS](docs/COSTS.md)
