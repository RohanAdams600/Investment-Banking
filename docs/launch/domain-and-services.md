# Domain and services: exactly what to buy and set up

Three accounts and one domain. Total cost is the domain — roughly $12 for the
first year. Everything else is free at your volume.

Do them in this order; each unblocks the next.

---

## 1. The domain (~$12/year)

### What to buy

Your legal name is already set to **Ashlar Markets, Inc.**, so the domain that
matches it is the one to try first.

| Priority | Domain | Why |
| --- | --- | --- |
| **1** | `ashlarmarkets.com` | Matches the legal name exactly. `.com` is what a 55-year-old business owner trusts and types by default — that matters more here than being clever. |
| 2 | `ashlarmarket.com` | Singular. Same logic, slightly cleaner to say aloud. |
| 3 | `ashlar.markets` | Short and modern. A business owner may mistype it as `.com`, so if you take this one, buy the `.com` too and redirect. |
| 4 | `useashlar.com` | The fallback if the first three are gone. Reads as a startup rather than a marketplace, which is a mild cost. |

**Avoid `ashlar.com` even if it appears available at a price.** Ashlar-Vellum
has used the name in software since 1988 — see `docs/brand/naming.md`. A bare
`ashlar.com` is the one that invites a letter.

### Where to buy it

Cloudflare Registrar or Namecheap. Cloudflare sells at cost with no renewal
markup and includes DNS; Namecheap is marginally simpler if you've used it
before. Either is fine — **turn on WHOIS privacy**, which both include free.
Your home address should not be in a public registry attached to a marketplace
handling confidential financials.

### Then tell me

Once it's bought, give me the name and I'll set `NEXT_PUBLIC_SITE_URL`, the
brand config, canonical URLs, OG image URLs and the email sender in one commit.

---

## 2. Resend — email (free: 3,000/month)

Needed for: access-request notifications, saved-search alerts, NDA
notifications, password resets that don't land in spam.

1. Sign up at resend.com. No card.
2. **Domains → Add Domain** → enter your new domain.
3. It will show you records to add at your registrar. They look like this —
   **copy the values Resend gives you, not these**:

   | Type | Name | Value |
   | --- | --- | --- |
   | MX | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | (a long DKIM key Resend generates) |

4. Add a DMARC record yourself — Resend won't prompt for it and it materially
   improves deliverability:

   | Type | Name | Value |
   | --- | --- | --- |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.com` |

   Start at `p=none` — it monitors without rejecting. Tighten to `quarantine`
   after a few weeks of clean reports.

5. Wait for verification (minutes to an hour), then **API Keys → Create**.
6. Give me the key, or set `RESEND_API_KEY` in your deploy environment.

**Why the domain has to come first:** Resend will not send from a domain you
haven't verified, and email from a free subdomain goes to spam.

---

## 3. Upstash Redis — rate limiting (free)

Needed because without it, every rate limit in the product is an in-process
counter that resets on every cold start. That includes the MCP endpoint, which
accepts a credential from outside the browser.

1. Sign up at upstash.com. No card.
2. **Create Database** → Regional → pick the region nearest your Supabase
   project (`us-east-1`).
3. Copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN** from the
   REST API section.
4. Set both in your deploy environment.

`pnpm preflight --strict` fails without these, deliberately — a deploy should
not be able to ship believing it is rate limited when it is not.

---

## 4. Stripe — subscriptions (free to set up)

Needed before anyone can pay you the $99 or $299.

1. Sign up at stripe.com.
2. Stay in **test mode** for now. I'll build and test billing entirely against
   test keys; nothing touches real money until you activate.
3. Give me `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (test versions).
4. Activating the account later needs your business details — which needs the
   entity from `docs/launch/company.md`. Not a blocker for building.

**Do not send me a live secret key.** Test keys start `sk_test_`. If you ever
paste a live one anywhere, roll it immediately in the Stripe dashboard.

---

## Where these values go

Never in the repository. Two places:

- **Local:** `apps/web/.env.local` — already git-ignored.
- **Production:** your host's environment variables (Vercel → Settings →
  Environment Variables).

`pnpm preflight` fails the build if a service-role key ever appears with a
`NEXT_PUBLIC_` prefix, because that would compile it into the browser bundle
and hand every visitor a key that bypasses every policy in the database.

---

## What this unblocks

| Once you have | You get |
| --- | --- |
| Domain | Indexable site under a real name, working OG previews, a sender address |
| + Resend | Saved-search alerts, access-request notifications, password resets |
| + Upstash | Rate limits that actually limit; a strict preflight that passes |
| + Stripe | Revenue |
