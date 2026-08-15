# Naming candidates

**Status: RESOLVED — the name is Cairn.**

The shortlist and reasoning are retained below as the record of how the decision was
reached. Domain and trademark clearance are still outstanding; Cairn Capital operates in
asset management, which is close enough to the category to warrant a real search before
buying the domain.

Ten candidates against the stated criteria: capital-markets gravitas, one to three
syllables, works as a domain, no hyphenation, and nothing that overpromises given the
compliance posture (no "Instant", "Guaranteed", "Smart", "AI" in the name itself).

Domain and trademark availability have **not** been checked — that requires a registrar
lookup and a USPTO/state search, which are the founder's calls. The collision notes below
flag where a conflict is likely enough to check first.

| #   | Name           | Syllables | Rationale                                                                                                                                                                                  | Tagline                            | Collision risk                                                               |
| --- | -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------- |
| 1   | **Thesis**     | 2         | Buy-side insider language — every acquisition starts with an investment thesis. Signals you speak the buyer's language without explaining anything. Reads as confident rather than clever. | _Every deal starts with a thesis._ | Low–moderate. Generic English word; `.com` almost certainly held.            |
| 2   | **Cairn**      | 1         | A stacked-stone marker that shows the route to those who know to look for it. Discreet, durable, quietly navigational — and short enough to work as an icon-only mark.                     | _Mark the way._                    | Low. Some asset-management use (Cairn Capital); worth a check.               |
| 3   | **Bellwether** | 3         | The lead sheep whose bell the flock follows — in markets, the indicator that moves first. Fits a platform whose value is signal and matching.                                              | _The signal in the middle market._ | Low. Long for a wordmark; abbreviates poorly.                                |
| 4   | **Provenance** | 3         | The documented history that establishes what an asset actually is. Precisely what diligence produces, and a word that carries weight in exactly the rooms this platform is for.            | _Know what you're buying._         | Low–moderate. Used in art/luxury tech.                                       |
| 5   | **Fathom**     | 2         | A unit of depth and a verb meaning to understand fully. Diligence in one word. Warmer than the navy-and-gold competition without losing seriousness.                                       | _Depth before price._              | Moderate. Some SaaS use.                                                     |
| 6   | **Keystone**   | 2         | The wedge at the top of an arch that holds every other stone in place. A structural metaphor for an intermediary — the piece without which the deal does not stand.                        | _The center of the deal._          | High. Heavily used in PE and insurance.                                      |
| 7   | **Quorum**     | 2         | The minimum number required before a body can act. Evokes principals in a room and decisions being made, not listings being browsed.                                                       | _Where principals meet._           | Moderate. Some governance/legal tech use.                                    |
| 8   | **Verity**     | 3         | Truth, in its formal register. Points at the platform's actual product — verified parties, verified financials, an audit trail — without claiming to guarantee anything.                   | _Diligence, first._                | Moderate. Verity has fintech and healthcare use.                             |
| 9   | **Meridian**   | 4         | A line of longitude and the highest point a body reaches. Maximum capital-markets gravitas; would sit unremarkably beside Houlihan Lokey.                                                  | _Find your line._                  | **Very high.** Meridian Capital, Meridian Partners, and others. Check first. |
| 10  | **Alder**      | 2         | A tree that grows first on disturbed ground and fixes nitrogen for what follows — infrastructure, literally. Understated, ownable, and short. Nothing about it shouts.                     | _Built for what follows._          | Low. Alder is used in some VC naming; likely clearable.                      |

## Recommendation

**Cairn** and **Thesis** are the two worth checking first.

_Cairn_ is the strongest pure brand: one syllable, a mark that draws itself (stacked
forms), low collision risk, and a meaning — a quiet marker left by someone who went
first — that fits a platform selling discretion. Its weakness is that the meaning needs
one sentence of explanation on first contact.

_Thesis_ needs no explanation to the target buyer at all, which is worth a great deal at
the top of a funnel. Its weakness is the reverse: as a common noun the domain and
trademark position will be harder and more expensive.

If both are blocked, **Provenance** is the strongest fallback — it needs no explanation
either, and it names the thing the product actually produces.

## How the name is wired into the code

Nothing here is hard-coded. The chosen name lives in one environment variable and flows
to every surface — page titles, transactional email, generated PDFs, legal footers:

```
NEXT_PUBLIC_BRAND_NAME="Cairn"
NEXT_PUBLIC_BRAND_TAGLINE="The marketplace for buying and selling businesses"
BRAND_LEGAL_NAME="Cairn Markets, Inc."   # pending incorporation
```

Read through `packages/core/src/brand`. The support email and mailing address are still
development defaults; `unconfiguredBrandFields` reports them and the app shows a warning
badge, because both appear in the site footer and in commercial email where a placeholder
is a wrong disclosure rather than a cosmetic gap.
