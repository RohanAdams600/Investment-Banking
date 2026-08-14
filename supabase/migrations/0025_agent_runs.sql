-- The orchestrator's record of what it did.
--
-- ---------------------------------------------------------------------------
-- Why a table, and not a log line
-- ---------------------------------------------------------------------------
--
-- The specification requires that every "AI recommends" surface shows its
-- reasoning or its inputs. That is easy to satisfy on the day a feature ships
-- and impossible to satisfy three months later, when a seller asks why their
-- listing was scored the way it was and the only record is a log line that
-- rolled off. So a run is a row.
--
-- It is also what makes the four-step pipeline reviewable rather than magical.
-- A seller who submits a business gets an analysis, a valuation and a set of
-- matches; each of those is a run with a status, and when one fails the seller
-- sees which one rather than an empty screen.
--
-- ---------------------------------------------------------------------------
-- What `inputs` may contain, and what it may not
-- ---------------------------------------------------------------------------
--
-- **Not the confidential figures.** The temptation is to store everything that
-- went in, for reproducibility. That would make this table a second copy of the
-- NDA-gated half of every listing, sitting behind its own policies rather than
-- the ones written for it in 0016 — and the first time somebody widens access
-- here "so support can debug", the gate is gone.
--
-- So `inputs` records *what was read*, not the values: which listing, how many
-- financial years, which criteria version, whether a profile existed. Enough to
-- explain a result and to re-run it against the source of truth, and not enough
-- to be a disclosure on its own.
--
-- `output` is different: it holds what the run produced, which is the thing the
-- user is being shown anyway. Where a step produces something derived from
-- confidential data — a match explanation — it is redacted before it gets here,
-- by the same `redactFitResult()` the scores go through.

create type app.agent_kind as enum (
  -- Step 1: what is wrong with this listing.
  'analyse_listing',
  -- Step 2: what it might be worth.
  'value_listing',
  -- Step 3: who might buy it.
  'match_buyers',
  -- Step 4: a message to one of them, for a human to approve.
  'draft_outreach',
  -- Out of band: reviewing a legal document a party uploaded.
  'review_document'
);

create type app.agent_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  -- Finished, and deliberately stopping here. The pipeline reaches this state
  -- at the outreach step and does not pass it without a person.
  'needs_approval'
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),

  kind app.agent_kind not null,
  status app.agent_status not null default 'queued',

  -- What it was about. Exactly one is set for a listing-scoped run; a document
  -- review carries a draft id instead.
  listing_id uuid references public.listings (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete cascade,

  -- Who it ran for. Not "who triggered it": a scheduled recompute has no
  -- clicker, and the person who needs to see the result is the same either way.
  subject_user_id uuid references auth.users (id) on delete cascade,
  firm_id uuid references public.firms (id) on delete cascade,

  /*
   * What was read, never what it said. See the note at the top of this file —
   * this column is the one that would quietly become a second copy of the
   * confidential half if nobody was watching.
   */
  inputs jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,

  -- Which model, if any. Null is the normal case: the analysis and valuation
  -- steps are deterministic and a model never sees them.
  model text check (model is null or char_length(model) <= 100),
  provider text check (provider is null or char_length(provider) <= 40),

  duration_ms integer check (duration_ms is null or duration_ms >= 0),

  -- Why it failed, for the person looking at the failure. Plain text, shown as
  -- plain text.
  error text check (error is null or char_length(error) <= 2000),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  created_at timestamptz not null default now(),

  constraint agent_runs_finished_has_timestamp check (
    status in ('queued', 'running') or finished_at is not null
  ),
  constraint agent_runs_failed_has_reason check (status <> 'failed' or error is not null)
);

create index agent_runs_listing_idx on public.agent_runs (listing_id, kind, created_at desc);
create index agent_runs_subject_idx on public.agent_runs (subject_user_id, created_at desc);
create index agent_runs_pending_idx on public.agent_runs (status) where status in ('queued', 'running');

-- ===========================================================================
-- The gate the specification actually asks for
-- ===========================================================================
--
-- "No agent sends anything externally without a human clicking send" is already
-- enforced on `outreach_drafts` by 0017's approval trigger. This is the other
-- half of the same rule: a `draft_outreach` run may not report success, because
-- succeeding would mean it finished the job, and the job is not finished until
-- a person has read what it wrote.
--
-- Belt and braces on purpose. The outreach table refuses the send; this refuses
-- the claim that no send was needed.

create or replace function app.enforce_agent_terminal_state()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.kind = 'draft_outreach' and new.status = 'succeeded' then
    raise exception 'A drafting run ends at needs_approval; only a person can finish it'
      using errcode = '42501';
  end if;

  if new.status in ('succeeded', 'failed', 'needs_approval') and new.finished_at is null then
    new.finished_at := now();
  end if;

  if tg_op = 'UPDATE' then
    -- A finished run is a record. Re-running produces a new row, so that "what
    -- did it say last week" stays answerable.
    if old.status in ('succeeded', 'failed', 'needs_approval')
       and new.status is distinct from old.status then
      raise exception 'A finished run cannot be reopened; start a new one'
        using errcode = '42501';
    end if;

    if new.kind <> old.kind or new.listing_id is distinct from old.listing_id then
      raise exception 'A run cannot be moved to another subject'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger agent_runs_enforce_terminal_state
  before insert or update on public.agent_runs
  for each row execute function app.enforce_agent_terminal_state();

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.agent_runs enable row level security;
alter table public.agent_runs force row level security;

/*
 * A run is visible to the person it was run for.
 *
 * Which is the seller for a listing-scoped run, and whoever controls the
 * listing — a broker managing it on the seller's behalf needs to see why the
 * matcher produced what it did, and telling them to ask the seller is not a
 * workflow.
 *
 * Not visible to the buyers who were matched. The run's output explains the
 * seller's business to the seller; a buyer's view of the same matching is
 * `match_scores`, which is redacted for exactly that reason.
 */
create policy agent_runs_select_subject on public.agent_runs
  for select to authenticated
  using (
    subject_user_id = auth.uid()
    or (listing_id is not null and app.controls_listing(listing_id))
    or (firm_id is not null and app.is_firm_member(firm_id))
  );

-- No insert, update or delete policy. Runs are written by the orchestrator with
-- the service role, because a run reads every buyer's criteria against a
-- listing's confidential figures — something no user may do. A client that
-- could write here could also fabricate an approval trail for outreach that was
-- never reviewed.

grant select on public.agent_runs to authenticated;

-- ===========================================================================
-- What the pipeline currently says about one listing
-- ===========================================================================
--
-- The latest run of each kind, which is what a status panel needs and what a
-- naive query gets wrong — `order by created_at desc limit 4` returns four runs
-- of whichever step ran most often.
--
-- Definer, because it reads `agent_runs` for a listing the caller controls and
-- the control check is cheaper to do once here than to re-derive per row. The
-- check is inside the body, so it cannot be pointed at somebody else's listing.

create or replace function public.listing_pipeline_state(target_listing_id uuid)
returns table (
  kind app.agent_kind,
  status app.agent_status,
  output jsonb,
  error text,
  model text,
  finished_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select distinct on (r.kind)
    r.kind,
    r.status,
    r.output,
    r.error,
    r.model,
    r.finished_at
  from public.agent_runs r
  where r.listing_id = target_listing_id
    and app.controls_listing(target_listing_id)
  order by r.kind, r.created_at desc;
$$;

revoke all on function public.listing_pipeline_state(uuid) from public, anon;
grant execute on function public.listing_pipeline_state(uuid) to authenticated;
