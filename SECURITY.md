# Security & production readiness

What this platform enforces, what it deliberately does not claim, and what is
still the account owner's to switch on. Ordered so the blocking items come
first.

**Nothing here is a guarantee of legal or regulatory compliance.** These are
mechanisms that support a compliance process, configurable per jurisdiction.
Whether they satisfy a given regulator is a question for your own counsel.

---

## 1. Blocking — the site does not work correctly without these

| Item | State | Notes |
| --- | --- | --- |
| Migrations 0030–0038 | **Applied** | 28 verification checks pass against the live project. |
| Migration 0039 | **NOT APPLIED** | Listing creation is refused until it runs. `supabase/apply-0039.sql` — paste it, and read the PASS/FAIL rows it prints. |
| `SUPABASE_SERVICE_ROLE_KEY` | Not set | Server-side only. Never `NEXT_PUBLIC_`; preflight fails the build if that prefix ever appears on it. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Not set | Without a shared store every rate limit is an in-process counter that resets on each cold start — i.e. not limiting anything. `preflight --strict` fails without it. |
| `RESEND_API_KEY` | Not set | Nothing emails anyone until it is set; a seller learns about an access request only when they next sign in. |

**Verify a migration actually landed.** A dashboard paste has silently applied
nothing on this project while reporting success. Every migration bundle ends
with a verification block for that reason — run it and read it.

## 2. What the database enforces

Authorization is in two layers, and the database is the one that decides.

- **Row Level Security on every table**, `enable` and `force`. A verification
  check fails the schema if any table has RLS off, or has RLS on and no policy.
- **The confidentiality split.** A listing's teaser and its confidential half
  are separate tables. `listing_details` opens only to a buyer holding an NDA
  the seller issued, that has not expired and has not been revoked — proved by
  the nine-step journey in `supabase/tests/end-to-end.test.ts`.
- **RLS is row-level, so columns are hidden with views, never policies.** The
  public market (`market_listings`) exposes teaser columns and deliberately has
  no `id` and no `seller_id`; a policy on the table would have exposed both.
- **The two views that are their own access check are barrier views.** Without
  `security_barrier` the planner pushes a caller's predicate underneath the
  view's security qual and evaluates it against rows being discarded. Both are
  definer views on purpose; making them invoker views empties them.
- **Every `app.*` function pins `search_path`**, checked by the schema tests.
- **`EXECUTE` is revoked from `PUBLIC` on every new function.** Postgres grants
  it on creation; four functions are anon-executable by design and the
  verification block names them.
- **Privileged actions are attributed by the database, not the caller.** A
  reviewer's identity on a verification decision is taken from the session.

## 3. What the application enforces

- **Server-side authorization on every sensitive route and mutation.** Client
  role data is never trusted; capabilities are re-checked in the route and
  again by RLS.
- **No service-role client in any request path** except the MCP token exchange
  and the notification mailer, both server-only.
- **Zod validation on every server action and API route.**
- **Plain-text rendering only.** No `dangerouslySetInnerHTML` anywhere.
- **CSP with a per-request nonce**, `frame-ancestors 'none'`, `form-action
  'self'`, plus HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY` and a
  restrictive `Permissions-Policy`. Deploy report-only, walk the site, then set
  `CSP_ENFORCE=true`.
- **Rate limits** on messaging, membership changes, listing creation, NDA
  requests, match recomputation, outreach drafts, MCP requests, funding
  submissions, and the one anonymous write. See section 1 — they are only real
  with a shared store.
- **Bounded reads.** Every list query is capped; PostgREST silently truncates
  at 1000 otherwise.
- **The MCP endpoint** is limited before authentication, keyed on the token
  digest, with a 64 KiB body cap counted off the stream rather than trusted
  from `content-length`.
- **Audit events** are written for privileged actions.

## 4. Deliberate limits — do not market these as more than they are

- **AI valuations are estimates for discussion only.** Never a recommendation
  to buy, sell or price a business at a figure. Every estimating surface shows
  its inputs.
- **No agent sends anything to a third party without a human clicking send.**
  The MCP scope enum has no value meaning "send", so the capability does not
  exist to be misconfigured later.
- **Funding verification is a person reading documents a buyer offered.** Not a
  credit check, not a source-of-funds investigation, not KYC/AML, and not a
  guarantee that any buyer will complete a purchase.
- **Payments and escrow are out of scope.** Commission is record-keeping only.
  Do not take custody of transaction funds without asking counsel about money
  transmitter licensing.
- **Compliance features are tools, not guarantees**, configurable per state.

## 5. Still the account owner's to switch on

These cannot be done from the codebase and are not done.

| Control | Where | Why it matters |
| --- | --- | --- |
| **MFA on the Supabase org and on GitHub** | Provider consoles | The database holds every seller's confidential financials. |
| **Restrict the service-role key** | Supabase → API | Rotate it if it has ever been pasted anywhere shared. |
| **Point-in-time recovery / backups** | Supabase → Database | Confirm the retention window and *test a restore*. |
| **Log drain and alerting** | Supabase → Logs, host | Nobody is watching auth failures or 5xx rates today. Tell me email or Slack and I will build the detection. |
| **Dependency scanning** | GitHub → Dependabot / `pnpm audit` in CI | Not currently enforced on the branch. |
| **WAF / bot protection** | Host (Vercel) | The public market is crawlable by design and therefore scrapeable. |
| **Secret scanning + push protection** | GitHub → Settings | |
| **Custom SMTP for auth email** | Supabase → Auth | The shared sender is rate-limited and hurts deliverability. |
| **Auth hardening** | Supabase → Auth | Confirm email required, session lifetime, leaked-password protection. |
| **A real trademark clearance** | Counsel | `docs/brand/naming.md` is a knock-out screen, not a clearance. |
| **State brokerage licensing** | Counsel | Decides what you may charge a success fee for. See `docs/launch/company.md`. |

## 6. When something goes wrong

`docs/security/incident-runbook.md` — what to do in the first fifteen minutes,
the queries that answer "what was reached", and who to call. Its contacts table
is empty; fill it in before you need it.

`/.well-known/security.txt` publishes the reporting address and a safe harbour,
so a researcher emails you rather than posting.

## 7. Reporting a vulnerability

Email the address in `BRAND_SUPPORT_EMAIL` (currently a development
placeholder — set it before launch). Please do not open a public issue.
