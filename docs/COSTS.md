# Costs

Figures are as published in October 2026. Check them before relying on them.

## Fixed costs

- **GitHub:** free for this use (Pages and Actions on a public repository).
- **Cloudflare, free plan:**
  - Workers: 100,000 requests a day and 10 ms of CPU per request.
  - D1: 5 million rows read and 100,000 rows written a day, 5 GB of storage, and 7 days of Time Travel.
  - **Workers Paid**, if needed: $5 a month, including 10 million requests and 50 million D1 rows
    written a month, with 30 days of Time Travel.

## A sitting

With n candidates and N questions, a sitting costs about 2·n·N requests (one per slot, one per answer)
and n·N answer rows.

| Sitting | Requests | Rows written | Free plan? |
|---|---|---|---|
| 100 × 60 | ≈ 12,000 | ≈ 6,000 | yes, about 8 a day |
| 1,000 × 90 | ≈ 180,000 | ≈ 90,000 | no: needs Workers Paid |

## Payments (Paystack, Nigeria)

Confirm these figures in the dashboard before going live.
- Local payments: 1.5%. The ₦100 flat fee is waived below ₦2,500, and fees are capped at ₦2,000.
  - A ₦100 unlock nets about ₦98.50.
  - A ₦500 report nets about ₦492.50.
- International cards: 3.9% + ₦100. If the flat fee applies, it exceeds a ₦100 unlock, so
  international cards stay off.

## Model (Claude API) — the main variable cost

- Every call's tokens and estimated cost go into `ai_usage`, and each lecturer has a monthly quota
  (`config/tiers.json`).
- Estimate for one quiz-sized generation (about 13,000 tokens of notes, the questions, and the re-solve):

  | Model | Cost per generation |
  |---|---|
  | `claude-opus-5` | about $1 |
  | Sonnet 5 | about $0.40 |
  | Haiku 4.5 | about $0.20 |

  The Batch API would halve these, but returns its answers asynchronously.
- Transcribing a photographed page costs roughly $0.025 on `claude-opus-5` (an image of up to 1,600 px).
- Approved questions are reused across sittings and years, so the cost is spread over them.

## NIN lookups

Published prices from $0.04–0.06 (Dojah), or ₦100 (Ninja), per lookup. Who pays is the owner's decision.
