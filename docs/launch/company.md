# Turning this into a company

The code is not the company. This file is the part that no amount of building
finishes — entity, insurance, licensing, and the go-to-market that follows.

**Nothing in this file is legal, tax, or financial advice, and nothing here makes
anyone compliant with anything.** It is a list of the questions to take to your own
attorney and accountant, ordered so the expensive ones get asked first. Several
items below are genuinely jurisdiction-dependent and have real consequences if
guessed at.

---

## 1. The one that has to be answered first

**Does the state you operate in regulate brokering the sale of a business?**

Some US states require a real estate licence to broker a business sale, at least
where real property is part of the transaction; some regulate business brokerage
directly; some do neither. The answer varies, it changes what you can legally
charge a success fee for, and it is not a question to resolve from a web search.

Ask a business transactions attorney in one state — the state you intend to open
first — before taking a commission on anything. The platform is built so this
is answerable per jurisdiction rather than nationally: `jurisdictions` has an
`is_active` flag, and 0029 seeds the states inactive. Open one. Get its answer.
Then open the next.

Related questions worth putting in the same conversation:

- Whether describing a fee arrangement as a "commission" changes the analysis.
- Whether the NDA and LOI templates in `/tools/legal-documents` can be offered
  as templates at all, and with what wording around them.
- Whether anything in the valuation tool reads as an appraisal in that state.
- For healthcare listings specifically: corporate practice of medicine rules,
  which restrict who may own a practice and can change whether a transaction is
  a sale at all.

## 2. Corporate scaffolding

| Item | Why it is on the list |
| --- | --- |
| Entity formation | `BRAND_LEGAL_NAME` is currently a placeholder pending this. It appears in the footer and in commercial email, where a placeholder is a wrong disclosure rather than an untidy one. |
| EIN | Needed before a business bank account. |
| Business bank account | Never take a customer payment into a personal account. |
| **E&O insurance** | You will sit between two parties in a transaction where one of them eventually becomes unhappy. This is the item most often skipped and most expensive to have skipped. |
| Registered agent | Required in most states; trivial and cheap. |
| Terms of service and privacy policy reviewed by counsel | `/legal/terms` and `/legal/privacy` render whatever is in the database. They are placeholders until a lawyer has read them. |
| Trademark clearance | See `docs/brand/naming.md`. The Ashlar screen is a knock-out screen, not a clearance search, and Ashlar-Vellum has used the name in software since 1988. Resolve before printing anything. |

## 3. Deployment blockers, in dependency order

Each of these depends on the one above it.

1. **Apply migrations 0030–0037.** `supabase/bundle.sql` is the whole set in one
   paste-able file; `supabase/verify.sql` checks it landed. All 22 checks must
   read PASS. Until this is done there is no public market, no search, no
   sector pages with content behind them, no interest capture, and no buyer
   verification.
2. **`SUPABASE_SERVICE_ROLE_KEY`.** Server-side only, never `NEXT_PUBLIC_`.
   Preflight has a check that fails the build if it ever carries that prefix,
   because a service-role key in the client bundle bypasses every policy in the
   database for anybody who views source.
3. **Domain**, then `NEXT_PUBLIC_SITE_URL`, `BRAND_SUPPORT_EMAIL`,
   `BRAND_MAILING_ADDRESS`. The mailing address is not decoration — a physical
   address is required on commercial email under CAN-SPAM.
4. **Deploy**, then `select app.bootstrap_admin('you@yourdomain.com');` so an
   operator account exists at all.
5. **`RESEND_API_KEY`.** Until it is set nothing emails anyone: a buyer requests
   access and the seller finds out the next time they happen to sign in.
6. **Walk the site with CSP report-only**, read the violations, then set
   `CSP_ENFORCE=true`.
7. **`NEXT_PUBLIC_ALLOW_INDEXING=true` last**, and only once there is something
   worth indexing. Google's first crawl of an empty market takes weeks to
   re-earn.

Run `pnpm preflight --strict` before each deploy. It prints the difference
between "the build passed" and "the website works", which is entirely
configuration and fails silently otherwise.

---

## 4. The cold start

A marketplace with no listings is worth nothing to a buyer, and one with no
buyers is worth nothing to a seller. **Advertising does not fix this. It makes
more people watch it fail.**

The product already handles the honest version: `market_is_open()` is derived
from live listings rather than a flag somebody has to remember to flip, and
while there are none, the market shows an interest capture instead of an empty
grid.

Break the tie by hand. Every marketplace that worked did this, and none of them
advertise that they did:

- **Get 10–20 listings by phone.** Call business brokers, offer free listing and
  do the data entry yourself. A broker arrives with fifteen listings; an owner
  arrives with one. Ten broker conversations beat ten thousand dollars of paid
  search at this stage, and it is not close.
- **Recruit buyers where they already are** — search funds, independent
  sponsors, HVAC and dental and landscaping roll-ups, SBA lenders. These people
  are actively hunting and easy to find by name.
- **Open one metro or one sector, not ten.** Fifteen HVAC businesses in one
  state reads as a market. The same fifteen spread across ten sectors and forty
  states reads as abandoned.

## 5. Advertising

Four channels are worth considering. They are not worth running at once.

**Organic search — the highest leverage, and what the product is now built for.**
Someone searching "buy an HVAC business in Ohio" is the best-qualified traffic
on the internet for this and costs nothing per click. The ten sector pages at
`/businesses-for-sale/industry/[industry]` exist for exactly this, are
statically generated, and are in the sitemap. They rank on the guide content,
not on inventory, which is why they were written to stand up with zero listings
on them.

What follows, in order: individual listings get indexed as they are published
(already wired); then metro pages if one sector concentrates; then genuinely
useful writing on how a sale works.

**Direct broker outreach — sales rather than advertising, and the best return per
hour.** It is also the only channel that solves supply. Do it yourself, by phone
and email, for the first sixty days.

**LinkedIn — slow, cheap, compounding.** One post a week about how a business
sale actually works, written by you. It builds the credibility that makes the
cold calls answerable.

**Paid search — last, and only once listings exist.** Bidding on "sell my
business" against a competitor who has been buying that term for twenty years,
with an empty marketplace behind it, is an expensive way to learn something you
already know. When you do turn it on, bid the long tail — sector plus geography
— never the head terms.

### The thing to actually say

The confidentiality mechanism is a provable claim, and almost nobody else in
this category can make it: your business stays anonymous until you personally
issue a confidentiality agreement, the database enforces it on every read, and
it is tested on every build. A seller's largest fear is that employees,
customers and competitors find out. Lead with that, everywhere, ahead of
anything about AI.

## 6. What the AI may and may not do in any of this

These are not style preferences. They are the constraints the product was built
under and they do not relax as it grows:

- **No agent sends anything to a third party without a human clicking send.**
  Agents draft; a person approves. The MCP scope enum has no value meaning
  "send", so the capability does not exist to be misconfigured later. Automated
  outbound in this industry is how you become spam, and then a defendant.
- **Every AI valuation is an estimate for discussion only** — never a
  recommendation to buy, sell or price a specific business at a specific value,
  and every surface that estimates shows its inputs. A marketing headline must
  not quietly convert that into a promise.
- **Nothing here guarantees compliance with anything.** The compliance features
  are tools supporting your own process, configurable per jurisdiction. Do not
  market them as guarantees.

## 7. Revenue

`/pricing` is live: Free, $99 broker, $299 firm, all free through launch, no
payment rail connected. That is the right shape for now — charge when brokers
are closing deals through the platform, not before.

Payments and escrow are deliberately out of v1. Commission is record-keeping
only (0021), with a clean seam where Stripe Connect goes later. Do not take
custody of transaction funds without asking counsel about money transmitter
licensing first; it is a materially different regulatory posture from charging
a subscription.

The order that works: subscriptions from advisors who get value first, success
fees only once §1 is answered for the state in question, paid placement (0031,
built, disclosed) once there is enough inventory that position is worth
something.
