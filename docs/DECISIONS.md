# Decisions

Each entry gives the decision and the reason for it. Change one only with measured evidence, and record
the change here.

## Product

1. **The lecturer's own material is the product.** Notes become quizzes; there is no central question
   bank, no subject taxonomy and no curriculum mapping. Each lecturer's approved questions form a private
   pool, and together these pools are the platform's asset. A shared bank, if one is ever wanted, will be
   built only from questions lecturers explicitly contribute, under a licence they choose. Reason:
   assembling a bank of every subject up front is out of proportion to what CA needs.
2. **Selection by page range.** Lecturers already set CA material by page ("Pages 13–16 of the typed
   Lecture 2 note"). Printed page numbers continue across files. Anchors and half-page markers handle
   partial pages. Word and source files have no fixed pages and are split at headings.
3. **Fixed cadence.** The "delay between questions" is the time each question is shown. Answering early
   does not advance the quiz. This keeps timing to a single parameter and makes it enforceable.

## Architecture

4. **GitHub carries everything except one function.** Pages serves the site and Actions run the tests
   and deploys. One Cloudflare Worker with a D1 database does the four things a static host cannot:
   - grade without sending answer keys to the browser;
   - stamp time with a clock the candidate cannot change;
   - verify payments with a secret key;
   - assign seats atomically.
5. **Rejected options.**
   - Supabase: free projects pause after a week without database activity.
   - Google Apps Script: each call takes seconds, concurrency quotas apply, and `doPost` cannot read
     request headers, so webhook signatures cannot be checked.
   - Google Forms with Actions: results take minutes, and questions cannot be released one slot at a
     time.
   - A framework or build chain.
6. **One handler, three runtimes.** The handler uses only web-standard APIs. It runs on Workers with D1
   in production, on `node:sqlite` in development and tests, and on sql.js in the browser demo. The
   demo lets GitHub Pages show the working system before any Cloudflare account exists.
7. **Plain HTML, CSS and ES modules.** Hash routes keep WhatsApp deep links from returning 404 on Pages.
   Browser libraries are vendored with pinned versions and load only where needed. The quiz page is
   12 kB gzipped.
8. **PDF through the browser's print dialogue.** No PDF library is needed, and slips print onto headed
   paper (an optional top margin is provided).

## Integrity

9. **Question orders unique by construction.**
   - The seat number is scrambled by an affine map modulo P(N, k*) = N!/(N−k*)!.
   - Its mixed-radix digits fix the first k* Fisher–Yates choices; a seeded DRBG makes the rest.
   - The Fisher–Yates map from choice sequences to permutations is a bijection, so distinct seats get
     distinct orders, with no registry and no retries.
   - Publication is refused when N! is smaller than the number of seats.
10. **Server gating.** Question k is served only during its slot. An answer counts only if it arrives
    between the slot's opening and its close plus the grace period (3 s by default). Grading is lazy, so
    no background job is needed.
11. **Rate limits are not keyed on the IP address alone.** A whole class may share one address (campus
    Wi-Fi, carrier NAT). The limits count failed codes per IP, check-ins per Google account, and only
    floods per IP.
12. **Grounded generation.** Every generated question carries a quote that must occur word for word on
    its cited page, or the question is discarded. A second, independent call answers the questions
    without their keys, and any disagreement marks the question disputed.

## Money

13. **Paystack only.**
    - The Worker initializes and verifies each payment, the signed webhook backs it up, and lazy
      settlement means a payment whose webhook never arrives still unlocks.
    - Prices live in `config/pricing.json`.
    - A purchased item is never charged twice.
    - Production refuses every fake.
14. **International cards stay off** until the owner decides. At 3.9% + ₦100 the fee can exceed a ₦100
    unlock.

## Identity

15. **Lecturer verification.**
    - Level 1 is an institutional address on a listed higher-education domain or `.edu.ng`, never a
      student address. It is proven by Google sign-in, with the `hd` claim matching the address's domain.
    - Level 2 is ORCID, Google Scholar or Scopus, by a challenge code checked by an admin. ORCID's Public
      API may not serve a revenue-generating service, Scholar has no API, and Scopus profiles cannot be
      edited by their authors.
    - Level 3 is a NIN, through a licensed provider; only an HMAC of the NIN is kept.
    - Gold Certified = Level 1 plus Level 2 or Level 3.
16. **Candidates.**
    - Roster seats are bound to registration numbers.
    - Late registrants take spare seats in order of arrival and are flagged for the lecturer.
    - Codes are offered for pupils; Google sign-in suits everyone else.
    - The newest session wins.
