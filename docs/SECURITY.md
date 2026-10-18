# Security and privacy

## Threats and controls

| Threat | Control |
|---|---|
| Reading answer keys in the browser | Keys and the sitting key never leave the server. The browser gets display letters only, and a test scans every candidate response for key fields. |
| Reading ahead | Each question is served only during its slot. |
| Changing the phone's clock | Every window uses the server's time. The page measures the offset once and then follows a monotonic clock. |
| Late answers after looking things up | An answer counts only until the slot's close plus the grace period, by the server's receipt time. |
| Copying a neighbour | Each seat has a distinct question order (guaranteed) and its own option order. |
| One candidate on several devices | The newest session wins. Older tokens receive 409. The switch is logged. |
| Forged Google sign-in | The Worker verifies every ID token: RS256 signature against Google's published keys, issuer, audience (this site's client ID) and expiry. The OAuth client has no redirect URIs, and its secret is used nowhere. |
| Impersonation at check-in | A roster email must match the Google account. A claimed registration number cannot be taken by another account, and the attempt is logged for the lecturer. Codes are 8 characters, stored hashed, and rate-limited on failure. |
| Unlocking without paying | The server verifies each payment with Paystack's secret key: status, amount, currency and reference. Webhooks are checked with HMAC-SHA512 in constant time. Entitlements are unique, so replays change nothing. |
| Cross-lecturer access | Every handler resolves session, then role, then owner scope through one function, and tests try cross-owner access. |
| Injection | SQL is parameterized only. Page text goes in as text nodes or through one renderer (escaped Markdown subset plus KaTeX with `trust` off). CSV cells that a spreadsheet could read as formulas get a leading apostrophe. |
| CSRF | Tokens travel in the Authorization header, with no cookies. |
| Floods | Per-IP ceilings are set high enough for a class behind one NAT. Failed codes, sign-ins, generation, NIN checks and payment starts are limited per subject. |
| Fakes in production | The Worker entry uses real services only. Without Paystack keys, payments answer 503. |
| The demo beside the live site | The demo at `?demo` runs in the browser and never calls the Worker. It keeps its own storage keys, so resetting it cannot sign anyone out of the live site. |

## Personal data

- **Collected:**
  - names and registration numbers (from the roster, or self-declared and marked as such);
  - email (verified by Google);
  - optional phone (unverified, and the form says so).
- **Pupils:** codes are the default for the primary tier, and no email or phone is collected from pupils.
- **Lecture notes:** the lecturer's intellectual property.
  - Only page text is stored, private to the owner and named co-lecturers.
  - Text is sent only to the AI provider, for processing, and the upload screen says so.
  - Notes can be deleted, with or without the questions derived from them.
- **NIN:**
  - passed once, through the Worker, to the provider;
  - never stored, logged or printed;
  - only the result, the provider's reference, the date, and HMAC-SHA256(NIN_PEPPER, NIN) are kept,
    so that one NIN certifies only one account;
  - a consent screen states the purpose and what is kept.
- **No webcams, biometrics or device fingerprinting.**

## Needs review — BLOCKED(user)

- Children's data under the Nigeria Data Protection Act 2023 and the GDPR: lawful basis, guardian
  consent, the controller and processor roles of schools and the platform, and retention periods. No
  compliance is claimed.
- NIN processing: the chosen provider's licensing and NIMC terms.
- Retention: retention periods are not yet configured.
