# Documentation

| Document                                                       | What it covers                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`roadmap.md`](./roadmap.md)                                   | The 12-step build sequence and where each step stands              |
| [`architecture.md`](./architecture.md)                         | Repository layout, token flow, planned data and agent architecture |
| [`design-system.md`](./design-system.md)                       | Tokens, component rules, the gold scarcity rule                    |
| [`environment.md`](./environment.md)                           | Every environment variable, and which are secret                   |
| [`deployment.md`](./deployment.md)                             | Local setup, CI, environments, launch-readiness checklist          |
| [`agents.md`](./agents.md)                                     | AI agent contracts and human-approval boundaries                   |
| [`data-model.md`](./data-model.md)                             | Entity inventory — schema pending step 2                           |
| [`decisions/open-questions.md`](./decisions/open-questions.md) | Decisions needed from the founder, with recommendations            |
| [`brand/naming.md`](./brand/naming.md)                         | Ten name candidates with rationale and taglines                    |
| [`brand/logo-brief.md`](./brand/logo-brief.md)                 | Creative brief for a designer or image tool                        |
| [`brand/brand-guide.md`](./brand/brand-guide.md)               | Positioning, voice, tone by surface, color and type rules          |

## Not yet written

These land with their build step rather than being written speculatively:

- **API reference** (OpenAPI, generated from route handlers) — step 4, when routes exist
- **Data model / ERD** — step 2. The entity inventory is in `data-model.md`; the schema
  waits on the multi-tenancy decision
- **Backup and restore procedure** — step 2, when there is a database to restore

## Keeping this current

Documentation is part of a step, not a follow-up to it. A step is not complete while its
documentation describes something other than what was built.

Two documents drift fastest and are worth checking on every change:

- `environment.md` — whenever a variable is added
- `roadmap.md` — whenever a step's status changes
