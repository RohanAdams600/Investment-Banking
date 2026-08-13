-- Matching, and outreach that a person has to approve.
--
-- Two tables that look unrelated and are not. The matcher finds a buyer worth
-- contacting; the outreach table is how that contact happens without an agent
-- ever emailing a stranger on its own.
--
-- ---------------------------------------------------------------------------
-- Why scores are stored rather than computed on demand
-- ---------------------------------------------------------------------------
--
-- Three reasons, in order of how much they matter:
--
--   1. **The scoring inputs are confidential.** A proper score needs the
--      seller's exact revenue, earnings and customer concentration — the
--      NDA-gated half. Computing at read time would mean the buyer's own
--      request reads data they are not entitled to. Computing ahead of time,
--      server-side, and storing only the redacted result means the confidential
--      figures never travel on a path the buyer can reach.
--
--   2. **A changed ranking has to be explainable.** `criteria_id` records which
--      version of the buyer's criteria produced the score, so "why did this drop
--      off my list" has an answer. Recomputed scores cannot answer it.
--
--   3. Speed, which is the least interesting reason and the one usually given.

create type app.outreach_channel as enum ('email', 'sms', 'in_app');

create type app.outreach_status as enum ('draft', 'approved', 'sent', 'discarded');

-- ---------------------------------------------------------------------------
-- Match scores
-- ---------------------------------------------------------------------------

create table public.match_scores (
  id uuid primary key default gen_random_uuid(),

  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,

  -- Which version of the buyer's criteria produced this. Not `on delete
  -- cascade`: superseded criteria are kept, and losing the link would leave a
  -- score nobody can account for.
  criteria_id uuid references public.acquisition_criteria (id) on delete set null,

  score smallint not null check (score between 0 and 100),

  -- The listing broke a limit the buyer stated as absolute. Kept as a row
  -- rather than deleted so the buyer can be shown what their own limits are
  -- filtering out — a buyer seeing nothing should be able to find out why.
  excluded boolean not null default false,

  /*
   * **Redacted before it is written.** `redactFitResult()` in packages/core
   * strips every figure out of the explanation, because the explanation is
   * generated from the confidential profile. A test there sweeps thousands of
   * input combinations and asserts no digit survives.
   *
   * Storing the unredacted reasons "just in case" would put the seller's
   * financials in a table any matched buyer can read. There is no in case.
   */
  reasons jsonb not null default '[]'::jsonb,
  exclusion_reasons jsonb not null default '[]'::jsonb,

  computed_at timestamptz not null default now(),

  -- One score per buyer per listing. Recomputing replaces rather than appends;
  -- the history that matters is the criteria version, which is referenced above.
  unique (listing_id, buyer_id)
);

create index match_scores_buyer_idx
  on public.match_scores (buyer_id, score desc)
  where not excluded;

create index match_scores_listing_idx on public.match_scores (listing_id, score desc);

-- ---------------------------------------------------------------------------
-- Outreach drafts
-- ---------------------------------------------------------------------------
--
-- The specification is unambiguous and this table is how it is kept: **no agent
-- sends anything to a third party without a human clicking send.** Generation is
-- automatic, delivery is not.
--
-- So the platform writes a personalised draft and stops. A person reads it,
-- approves it, and only then can it be sent. The trigger below makes that an
-- invariant of the data rather than a convention of the code — a future job that
-- forgets to check cannot mark something sent that nobody approved.
create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),

  listing_id uuid not null references public.listings (id) on delete cascade,
  -- Who it is addressed to. Restricted rather than cascaded: a sent message is
  -- a record of something that happened.
  recipient_id uuid not null references auth.users (id) on delete restrict,

  -- The seller or broker on whose behalf it goes out.
  created_by uuid not null references auth.users (id) on delete restrict,

  channel app.outreach_channel not null default 'in_app',
  status app.outreach_status not null default 'draft',

  subject text check (subject is null or char_length(subject) <= 300),
  body text not null check (char_length(body) between 1 and 10000),

  -- What the draft was built from, so a recipient asking "why me" can be
  -- answered, and so a bad batch can be traced to the run that produced it.
  match_score smallint check (match_score between 0 and 100),
  generated_by text check (generated_by is null or char_length(generated_by) <= 100),

  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Approval and sending each have to record who and when. A status word with
  -- no accompanying evidence is not an approval.
  constraint outreach_approved_has_approver check (
    status = 'draft' or status = 'discarded'
    or (approved_by is not null and approved_at is not null)
  ),
  constraint outreach_sent_has_timestamp check (
    status <> 'sent' or sent_at is not null
  )
);

create index outreach_drafts_listing_idx on public.outreach_drafts (listing_id, status);
create index outreach_drafts_recipient_idx
  on public.outreach_drafts (recipient_id) where status = 'sent';

create trigger outreach_drafts_touch_updated_at
  before update on public.outreach_drafts
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- The approval gate
-- ===========================================================================

create or replace function app.enforce_outreach_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    -- Nothing is created already approved or already sent. Generation and
    -- approval are separate acts by construction, so there is no path where one
    -- statement does both.
    if new.status <> 'draft' then
      raise exception 'Outreach is created as a draft and approved separately'
        using errcode = '42501';
    end if;
    new.approved_by := null;
    new.approved_at := null;
    new.sent_at := null;
    return new;
  end if;

  -- Who it is to, and what listing it concerns, are fixed. Otherwise a draft
  -- approved for one recipient could be redirected to another after the fact,
  -- and the approval would be evidence of something that never happened.
  if new.recipient_id <> old.recipient_id or new.listing_id <> old.listing_id then
    raise exception 'An approved draft cannot be redirected'
      using errcode = '42501';
  end if;

  -- Editing the message after approval voids it. The person approved specific
  -- words, and this is what stops "approve a bland draft, then rewrite it".
  if old.status = 'approved'
     and (new.body is distinct from old.body or new.subject is distinct from old.subject) then
    raise exception 'Editing an approved draft withdraws the approval; return it to draft first'
      using errcode = '42501';
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    if old.status <> 'draft' then
      raise exception 'Only a draft can be approved'
        using errcode = '42501';
    end if;
    -- Stamped here, never accepted from the caller. An approver who can name
    -- somebody else as the approver is not an audit trail.
    new.approved_by := caller;
    new.approved_at := now();
  end if;

  if new.status = 'sent' and old.status <> 'sent' then
    -- The line the whole table exists to hold.
    if old.status <> 'approved' or old.approved_by is null then
      raise exception 'Outreach must be approved by a person before it can be sent'
        using errcode = '42501';
    end if;
    new.sent_at := now();
  end if;

  -- A sent message is history.
  if old.status = 'sent' and new.status <> 'sent' then
    raise exception 'A sent message cannot be unsent'
      using errcode = '42501';
  end if;

  if old.status = 'sent' and (new.body is distinct from old.body) then
    raise exception 'A sent message cannot be edited'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger outreach_drafts_enforce_approval
  before insert or update on public.outreach_drafts
  for each row execute function app.enforce_outreach_approval();

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.match_scores enable row level security;
alter table public.outreach_drafts enable row level security;

alter table public.match_scores force row level security;
alter table public.outreach_drafts force row level security;

-- A buyer sees their own scores. Nobody else's, and not the seller's view of
-- them — a seller learning that a named buyer scored 91% on their listing is a
-- negotiating advantage the buyer did not agree to hand over.
--
-- The seller's side is served by `app.match_summary()` below, which returns
-- counts and no identities.
create policy match_scores_select_own on public.match_scores
  for select to authenticated
  using (buyer_id = auth.uid());

-- No insert, update or delete policy for anyone. Scores are written by the
-- matcher with the service role, because scoring requires reading every
-- buyer's criteria and every listing's confidential figures — something no
-- user may do and no user needs to. A client that could write here could
-- promote itself up every seller's list.

-- Drafts are visible to the side that created them, and to the recipient only
-- once actually sent. A recipient reading their own pending draft would see a
-- message the sender has not decided to send.
create policy outreach_drafts_select_party on public.outreach_drafts
  for select to authenticated
  using (
    app.controls_listing(listing_id)
    or (recipient_id = auth.uid() and status = 'sent')
  );

create policy outreach_drafts_write_controller on public.outreach_drafts
  for insert to authenticated
  with check (app.controls_listing(listing_id) and created_by = auth.uid());

create policy outreach_drafts_update_controller on public.outreach_drafts
  for update to authenticated
  using (app.controls_listing(listing_id))
  with check (app.controls_listing(listing_id));

-- ===========================================================================
-- The seller's view of demand
-- ===========================================================================
--
-- A seller genuinely needs to know whether anyone is looking for what they have
-- — it is the difference between waiting and re-pricing. What they must not get
-- is a list of names, which would let them approach buyers around the platform
-- and would expose buyers who have disclosed their criteria in confidence.
--
-- So this returns arithmetic. Counts and a band, never a row per buyer.
create or replace function public.match_summary(target_listing_id uuid)
returns table (
  total_buyers integer,
  strong_matches integer,
  best_score smallint
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    count(*)::integer as total_buyers,
    count(*) filter (where m.score >= 70)::integer as strong_matches,
    -- Rounded down to the nearest ten. An exact best score, watched over time,
    -- reveals when one particular buyer's criteria changed.
    ((max(m.score) / 10) * 10)::smallint as best_score
  from public.match_scores m
  where m.listing_id = target_listing_id
    and not m.excluded
    -- The caller must control the listing. Checked inside the function rather
    -- than left to the caller, because this is `security definer` and would
    -- otherwise report on any listing at all.
    and app.controls_listing(target_listing_id);
$$;

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select on public.match_scores to authenticated;
grant select, insert, update on public.outreach_drafts to authenticated;

revoke all on function public.match_summary(uuid) from public, anon;
grant execute on function public.match_summary(uuid) to authenticated;
