# Environment variables

Copy `.env.example` to `.env.local` and fill in. `.env.local` is gitignored; real values
are never committed.

`NEXT_PUBLIC_`-prefixed variables are **inlined into the client bundle and are public**.
Anything secret must not carry that prefix.

## Brand

| Variable                    | Required         | Purpose                                                                                              |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_BRAND_NAME`    | Yes (production) | Display name — page titles, email, PDF headers, footers. Falls back to a placeholder in development. |
| `NEXT_PUBLIC_BRAND_TAGLINE` | Yes              | Marketing hero and OG description.                                                                   |
| `BRAND_LEGAL_NAME`          | Yes              | Legal entity name for contracts, terms of use, privacy policy.                                       |
| `BRAND_SUPPORT_EMAIL`       | Yes              | Support routing and email reply-to.                                                                  |
| `BRAND_MAILING_ADDRESS`     | Yes              | Footer and commercial-email compliance.                                                              |

The name is not hard-coded anywhere. Renaming the company is a change to these five values
plus a logo swap.

The name and tagline are settled (**Cairn** / "Mark the way."). `BRAND_SUPPORT_EMAIL` and
`BRAND_MAILING_ADDRESS` are still development defaults; `unconfiguredBrandFields` and
`isBrandFullyConfigured` are exported from `@ib/core` so launch-readiness checks fail while
either is in use. Both appear in the site footer and in commercial email, where a
placeholder is a wrong disclosure rather than a cosmetic gap.

## Site

| Variable                     | Required | Purpose                                                                                                                               |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`       | Yes      | Canonical origin for sitemaps, OG tags, absolute email links.                                                                         |
| `NEXT_PUBLIC_ALLOW_INDEXING` | Yes      | `"true"` permits search indexing. Anything else emits `noindex`. Defaults closed so pre-launch content cannot be indexed by omission. |
| `NEXT_PUBLIC_DEMO_DATA`      | Yes      | `"true"` renders sample statistics and testimonials with a visible marker. **Must be `"false"` in production.**                       |

## Supabase — build step 2

| Variable                        | Secret  | Purpose                                                                                                                                          |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | No      | Project URL.                                                                                                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No      | Anon key. Safe to expose **only because Row Level Security is enabled on every table** — a table without RLS is publicly readable with this key. |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Yes** | Bypasses RLS entirely. Server-side only. Never referenced in a client component, never given a `NEXT_PUBLIC_` prefix, never logged.              |

## AI providers — build step 8

| Variable            | Secret  | Purpose                                                          |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | **Yes** | Claude — primary reasoning, drafting, orchestration.             |
| `OPENAI_API_KEY`    | **Yes** | Secondary — embeddings and cost-sensitive structured extraction. |

Both are consumed only by the model router. No agent reads a provider key directly, which
is what keeps re-routing an agent a config change rather than a code change.

## Communications — build step 7

| Variable                          | Secret  | Purpose                                                                                                                                                  |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TWILIO_ACCOUNT_SID`              | No      | Twilio account.                                                                                                                                          |
| `TWILIO_AUTH_TOKEN`               | **Yes** | Twilio auth.                                                                                                                                             |
| `TWILIO_MESSAGING_SERVICE_SID`    | No      | SMS sender pool for notifications and OTP.                                                                                                               |
| `RESEND_API_KEY`                  | **Yes** | Transactional email. Provider not yet finalized — see open questions.                                                                                    |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | No      | Geographic search. **Must be restricted by HTTP referrer in the Google Cloud console** — an unrestricted browser key is billable by anyone who finds it. |

## Adding a variable

1. Add it to `.env.example` with a placeholder and a comment.
2. Document it in the right table above, marking whether it is secret.
3. Validate it at the boundary with zod, as `packages/core/src/brand` does — a missing
   variable should fail at startup with a readable message, not produce `undefined` three
   layers deep.
4. Add it to the deployment environments (see `docs/deployment.md`).
