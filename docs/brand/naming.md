# Naming

**Status: RESOLVED — the name is Ashlar.** It was Cairn until a preliminary screen found
the field crowded. What follows is the screen, the shortlist it killed, and — first,
because it is the part that matters — what the screen does not cover.

## What this is not

**This is a preliminary knock-out screen, not a trademark clearance.** It was run against
public web sources and secondary trademark databases. It does not cover:

- State trademark registrations
- Common-law use by unregistered businesses
- A likelihood-of-confusion analysis, which is the actual legal question and depends on
  channels of trade and consumer sophistication as much as on the words
- Any jurisdiction outside the United States
- Domain acquisition cost or squatter holdings

**Before spending money on the domain, incorporation, or anything printed, have a
trademark attorney run a real clearance search.** A knock-out screen finds the obvious
collisions. It is designed to save the cost of a clearance search on a name that was
never going to work — not to replace one on a name that might.

## Why Cairn was dropped

Not because of registrations. The US registrations are dead:

| Mark                        | Serial   | Status                                     |
| --------------------------- | -------- | ------------------------------------------ |
| CAIRN CAPITAL PARTNERS      | 76480293 | Abandoned 2005 — no statement of use filed |
| CAIRN CAPITAL NORTH AMERICA | 85254427 | Cancelled 2019 — Section 8                 |

The London firm that held the name rebranded to Polus Capital Management.

The problem is the live field, which is dense and sits in exactly our category:

| Firm                                  | What they do                                               |
| ------------------------------------- | ---------------------------------------------------------- |
| **Cairn Merchant Partners** (Toronto) | **Buy-side advisory, sell-side advisory, M&A, valuations** |
| Cairn Partners (Europe)               | Distressed M&A and restructuring                           |
| Cairn Investment Group                | Registered investment adviser                              |
| Cairn Advisors                        | Financial risk advisory                                    |
| Cairn Financial Advisors              | Registered investment adviser                              |

The first row is the disqualifying one. It is not an adjacent industry — it is the same
services this marketplace exists to support, described in the same words. A seller
googling the name alongside "sell my business" finds a merchant bank.

Registrability and discoverability are different problems. Cairn was probably registrable
and definitely not findable.

## The screen that followed

Six candidates were checked. The pattern was consistent enough to be worth stating as a
rule: **a plain English word plus financial services is a crowded field, essentially
always.** Everyone reaching for a name in this category draws from the same well.

| Candidate  | Result                                                                       |
| ---------- | ---------------------------------------------------------------------------- |
| Alder      | **Blocked.** Alder Capital LLC offers investment banking services; four more |
| Lintel     | **Blocked.** Lintel Bank — UK financial software, FCA pre-authorisation      |
| Bellrock   | **Blocked.** BellRock Securities (FCA), Bell Rock Capital (SEC RIA), more    |
| Fathom     | **Blocked.** Fathom is accounting analytics used for business valuations     |
| Keystone   | **Blocked.** Heavily used across PE and insurance                            |
| Meridian   | **Blocked.** Meridian Capital, Meridian Partners, and others                 |
| **Ashlar** | **Clear in financial services.** See below                                   |

## Why Ashlar

An ashlar is finely cut stone, squared and laid in precise courses — the opposite of
rubble. The word means _dressed, deliberate construction_, which is a fair description of
a product whose central claim is that the confidential half of a listing is structurally
separated from the public half and the separation is enforced by the database rather than
by an interface.

Practically:

- **No users found in financial services, business brokerage, M&A, or investment
  advisory** — the field where Cairn was crowded, and the only field that matters here.
- The hits are in unrelated classes: Ashlar-Vellum (CAD software), The Ashlar Group
  (staffing), a digital-marketing firm in Lahore.
- **The existing icon is already an ashlar mark.** Squared forms narrowing upward under a
  gold capstone — that is a stone course. The rename cost nothing in design.
- Distinctive rather than descriptive, so it is registrable as a mark.
- Two syllables, spells phonetically, no plural or possessive awkwardness.

**The one hit worth an attorney's attention** is Ashlar-Vellum, a CAD software company
that has used the name since 1988. Our services are class 35/36 (business brokerage,
financial services) and theirs is class 9/42 (software) — but this product is delivered as
software, so the overlap is not zero and it is not a question to answer by reading a web
search.

## The shortlist Cairn came from

Retained as the record of how the original decision was reached. The collision-risk column
turned out to be optimistic on every row that was subsequently checked, which is itself the
lesson: **collision risk guessed from a name is not evidence.**

| #   | Name       | Rationale                                                                           | Collision risk as guessed | As found    |
| --- | ---------- | ----------------------------------------------------------------------------------- | ------------------------- | ----------- |
| 1   | Thesis     | Buy-side insider language — every acquisition starts with an investment thesis.     | Low–moderate              | not checked |
| 2   | **Cairn**  | A stacked-stone marker that shows the route to those who know to look for it.       | Low                       | **Crowded** |
| 3   | Bellwether | The indicator that moves first. Fits a platform whose value is signal and matching. | Low                       | not checked |
| 4   | Provenance | The documented history that establishes what an asset actually is.                  | Low–moderate              | not checked |
| 5   | Fathom     | A unit of depth and a verb meaning to understand fully. Diligence in one word.      | Moderate                  | **Blocked** |
| 6   | Keystone   | The wedge at the top of an arch that holds every other stone in place.              | High                      | **Blocked** |
| 7   | Quorum     | The minimum number required before a body can act.                                  | Moderate                  | not checked |
| 8   | Verity     | Truth, in its formal register.                                                      | Moderate                  | not checked |
| 9   | Meridian   | A line of longitude and the highest point a body reaches.                           | Very high                 | **Blocked** |
| 10  | Alder      | A tree that grows first on disturbed ground and fixes nitrogen for what follows.    | Low                       | **Blocked** |

## How the name is wired into the code

One environment variable, flowing to every surface — page titles, transactional email,
generated PDFs, legal footers:

```
NEXT_PUBLIC_BRAND_NAME="Ashlar"
NEXT_PUBLIC_BRAND_TAGLINE="The marketplace for buying and selling businesses"
BRAND_LEGAL_NAME="Ashlar Markets, Inc."   # pending incorporation
```

This file used to claim the name was "not hard-coded anywhere". Performing the rename
found fourteen literal occurrences, eight of them in copy a customer reads — including a
disclosure on the listing page and a card title in the admin panel. The claim in the
comment was exactly what stopped anybody checking.

`packages/core/src/brand/brand.test.ts` now asserts it instead: a scan over committed
sources fails if any former or current company name appears as a literal in application
code, a component, or a migration. Add the old name to that list on the next rename rather
than removing it — the point is that a missed disclosure carrying a former company's name
is worse than a missed heading.

Support email and mailing address are still development defaults. `unconfiguredBrandFields`
reports them and the app shows a warning badge, because both appear in the site footer and
in commercial email where a placeholder is a wrong disclosure rather than an untidy one.
