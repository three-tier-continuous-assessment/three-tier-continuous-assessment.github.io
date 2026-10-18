# Standing rules for agents working in this repository

1. Report status in `docs/PROGRESS.md` with three labels:
   - DONE: implemented and tested;
   - MOCKED: works against a local fake of Paystack, Google, the model or the NIN provider;
   - BLOCKED(user): needs an account, a credential or a decision.
   Never present MOCKED as working.
2. Ask the owner before you create remote resources, enter live payment mode, spend API money beyond
   small test calls, or contact anyone.
3. Never read, print, copy or commit secrets or real personal identifiers. Fixtures are synthetic and
   labelled FIXTURE. Never use a real NIN anywhere.
4. Idempotency: the same inputs give byte-identical outputs. This covers seat orders, page hashes,
   reports rebuilt from stored records, and migrations that can be re-run.
5. Phones are a hard requirement. Every UI change keeps `npm run smoke:mobile` and
   `npm run smoke:flow` green. The quiz page stays under 100 kB before KaTeX.
6. Keep the handler on web-standard APIs only, so it runs unchanged on Workers, in Node and in the
   browser demo.
7. Text reaches the page only as text nodes or through `web/js/render.mjs`.
8. Documentation is formal and brief: README.md plus the four files in `docs/`, all kept true.
9. Keep the project runnable at every commit. Commit in small, described steps.
