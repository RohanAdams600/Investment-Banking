# AI agent reference

**Status: specification only. No agent is implemented — that is build step 8.**

This document is the contract each agent must satisfy when it is built, and the reference
for what each one is permitted to do.

## Invariants

These hold for every agent, without exception. They are architectural boundaries, not
settings, and a change to any of them is a change to the product's risk posture rather than
a configuration tweak.

1. **No autonomous external communication.** Any agent producing an email, SMS, or call
   drafts it and stops. A human clicks send. There is no "trusted agent" tier and no
   auto-send setting.
2. **Every AI surface renders `<AIDisclaimer />`.** With the variant matching the output
   type. The regulated variants carry fixed wording callers cannot override.
3. **Reasoning is always shown.** Every recommendation, score, or estimate displays the
   inputs or factors behind it. A conclusion with no visible basis does not ship.
4. **Everything is logged.** The Agent Activity Log records every action including
   suggestions the user never acted on, queryable per user and per deal.
5. **No agent certifies anything.** Not "diligence complete", not "SEC-compliant", not
   "this valuation is correct". Agents produce checklists, flags, drafts, and estimates.
6. **No agent reads a provider key.** All model calls go through the model router.

## Agents

| Agent                  | Purpose                                                                                       | Human boundary                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Buyer**              | Refines acquisition criteria, summarizes matching listings                                    | Read-only. Suggestions, no actions.                                                                              |
| **Seller**             | Helps complete a listing, flags gaps, suggests positioning                                    | Suggestions only. The seller publishes.                                                                          |
| **Matching**           | Scores buyer↔listing compatibility 0–100                                                      | Automated scoring. Top 3 reasons always shown.                                                                   |
| **Valuation**          | Estimated valuation range from financials and comparables                                     | Always a **range**, never a single number. Confidence and assumptions shown and editable. `variant="valuation"`. |
| **Due Diligence**      | Builds a DD checklist by deal type and industry; flags missing or expired documents           | Checklist and flags only. Never marks diligence complete.                                                        |
| **CRM**                | Logs interactions, drafts follow-up tasks                                                     | Tasks land as drafts. User confirms.                                                                             |
| **Document**           | Extracts terms and figures from P&Ls, tax returns, CIMs into structured fields                | Extraction shown side-by-side with the source. User verifies before save.                                        |
| **Market Research**    | Industry and comparable-transaction context                                                   | Cites sources and assumptions. `variant="market-context"`.                                                       |
| **Lead Generation**    | Identifies candidate buyers/sellers from user-supplied lists or public data the user supplies | Candidate list only. **No outreach.**                                                                            |
| **Outreach Assistant** | Drafts intro messages to a match                                                              | **Draft only.** Explicit click-to-send. Never autonomous.                                                        |
| **Meeting Assistant**  | Scheduling, reminders, agendas, note summaries                                                | Scheduling requires confirmation. Summaries are editable drafts.                                                 |
| **Analytics**          | Plain-language insight from dashboard data                                                    | Read-only. Never changes account settings.                                                                       |
| **Deal Assistant**     | Tracks a deal's stage and outstanding items across CRM, deal room, and messaging              | Aggregation and reminders only.                                                                                  |

## Per-agent contract

Every agent declares, in code:

```ts
interface AgentDefinition {
  name: string;
  input: ZodSchema; // validated before the model is called
  output: ZodSchema; // validated after; a malformed response fails loudly
  allowedTools: ToolName[]; // explicit allowlist, never implicit
  approvalBoundary:
    | 'none' // read-only, no side effects
    | 'confirm-action' // user confirms before the action commits
    | 'explicit-send'; // external communication — human clicks send
  modelShape: 'reasoning' | 'drafting' | 'extraction' | 'embedding';
  disclaimerVariant: AIDisclaimerVariant;
}
```

`modelShape` rather than a model name is what keeps routing a configuration concern. An
agent declares the kind of work it needs; the router picks the model. Re-routing an agent
for cost or latency touches config, not agent code.

## Valuation agent — specific constraints

The highest-exposure agent in the system, and the one most likely to be quietly weakened
by a well-meaning change.

- **Never outputs a single number.** A range, always.
- **Always shows its assumptions**, and they are editable — a user who disagrees with a
  multiple can change it and see the result move.
- **Always shows confidence**, and says what would raise it.
- **Never uses directive language.** "Consider", "comparable transactions suggest" — never
  "you should price at", never "this business is worth".
- **Always renders `<AIDisclaimer variant="valuation" />`.** Fixed wording. Not overridable.

## Matching agent — specific constraints

- Score is 0–100 and **explainable**. The top three contributing factors are always
  displayed. A black-box score does not ship.
- Weighted criteria match (industry, size, geography, structure) plus behavioral signal,
  plus embedding similarity on free-text thesis once that lands.
- Natural-language search shows the **parsed filters, editable**, so a user can see that
  "profitable HVAC business in the Southeast under $5M" was understood correctly — and fix
  it when it was not.
- Preference profiles are **versioned**, so a change in recommendations can be traced to a
  change in stated criteria rather than appearing as unexplained drift.
