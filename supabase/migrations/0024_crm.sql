-- The CRM.
--
-- ---------------------------------------------------------------------------
-- A contact is not a user, and that is the whole shape of this schema
-- ---------------------------------------------------------------------------
--
-- Most people in a broker's pipeline have never signed up and never will. The
-- accountant who refers deals, the owner who might sell in two years, the buyer
-- who called about a listing and gave a phone number — none of them are rows in
-- `auth.users`, and a CRM that could only track platform accounts would be a
-- CRM the broker keeps in a spreadsheet instead.
--
-- So `contacts` carries its own identity, with an **optional** link to a user.
-- When the person eventually signs up, the link is set and the history stays
-- attached. Building it the other way round — a profile row for everybody a
-- broker has ever met — would mean fabricating accounts nobody asked for, and
-- would put those people inside every policy that trusts `auth.users`.
--
-- ---------------------------------------------------------------------------
-- The tenant boundary
-- ---------------------------------------------------------------------------
--
-- Everything here is firm-scoped. A CRM is the most commercially sensitive
-- thing a brokerage owns — it is the business — and two brokers at different
-- firms sharing a platform must never see one another's pipeline. That is
-- `app.is_firm_member()` on every policy, and it is the same boundary the rest
-- of the schema already uses rather than a new one invented here.
--
-- Unaffiliated sellers have no firm. They get `owner_id`-scoped rows, so the
-- same tables serve one person tracking one sale and a twelve-broker shop.

create type app.contact_kind as enum (
  'buyer',
  'seller',
  'advisor',
  'lender',
  'referral',
  'other'
);

create type app.lead_source as enum (
  'listing_inquiry',
  'contact_form',
  'referral',
  'outbound',
  'event',
  'manual'
);

create type app.lead_status as enum (
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'converted'
);

create type app.task_status as enum ('open', 'done', 'cancelled');

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),

  -- One of these is set. A firm's contact belongs to the firm; a solo seller's
  -- belongs to them. Enforced by the check below rather than by convention,
  -- because a row with neither is invisible to every policy and a row with both
  -- would be visible through two different ones.
  firm_id uuid references public.firms (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,

  -- Set if and when this person becomes a platform user. Nullable forever is
  -- the normal case.
  user_id uuid references auth.users (id) on delete set null,

  full_name text not null check (char_length(trim(full_name)) between 1 and 200),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 50),
  company text check (company is null or char_length(company) <= 300),
  title text check (title is null or char_length(title) <= 200),

  kind app.contact_kind not null default 'other',

  -- Free-form, because every brokerage segments differently and an enum here
  -- would be wrong within a quarter.
  tags text[] not null default '{}',

  notes text check (notes is null or char_length(notes) <= 4000),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint contacts_has_one_owner check (
    (firm_id is null) <> (owner_id is null)
  )
);

create index contacts_firm_idx on public.contacts (firm_id);
create index contacts_owner_idx on public.contacts (owner_id);
create index contacts_user_idx on public.contacts (user_id) where user_id is not null;

/*
 * Deduplication is a constraint, not a nightly job.
 *
 * The same person inquires on three listings and fills in the contact form
 * twice, and a broker calling the same lead five times because the list said so
 * is how a brokerage loses a referral source. Postgres can simply refuse the
 * duplicate, so it does.
 *
 * Lower-cased, because `Sam@example.com` and `sam@example.com` are one person.
 * Partial, because a contact with no email is legitimate — a phone-only lead
 * from a yard sign — and a null does not collide with anything.
 *
 * Two indexes rather than one composite: a firm's contacts and a solo user's
 * are different namespaces, and a composite over two nullable columns would
 * never fire, since `null = null` is unknown and unique indexes let it pass.
 */
create unique index contacts_firm_email_unique
  on public.contacts (firm_id, lower(email))
  where firm_id is not null and email is not null;

create unique index contacts_owner_email_unique
  on public.contacts (owner_id, lower(email))
  where owner_id is not null and email is not null;

create trigger contacts_touch_updated_at
  before update on public.contacts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Pipeline stages
-- ---------------------------------------------------------------------------
--
-- Per firm, and ordered. Not an enum: a search fund's pipeline and a
-- twelve-broker shop's look nothing alike, and the specification asks for it to
-- be configurable. The default set is seeded by the function below rather than
-- hard-coded in the application, so a firm that has never opened the settings
-- page still has a working board.

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid references public.firms (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,

  name text not null check (char_length(trim(name)) between 1 and 60),
  position smallint not null check (position >= 0),

  /*
   * Whether landing here ends the lead's life.
   *
   * Kept as a flag rather than inferred from the last position, because "lost"
   * is terminal and is rarely last on the board — a stage list that has to be
   * reordered to change what counts as closed is a stage list somebody will
   * reorder by accident.
   */
  is_terminal boolean not null default false,
  is_won boolean not null default false,

  created_at timestamptz not null default now(),

  constraint pipeline_stages_has_one_owner check (
    (firm_id is null) <> (owner_id is null)
  ),
  constraint pipeline_stages_won_is_terminal check (not is_won or is_terminal)
);

create unique index pipeline_stages_firm_position
  on public.pipeline_stages (firm_id, position) where firm_id is not null;
create unique index pipeline_stages_owner_position
  on public.pipeline_stages (owner_id, position) where owner_id is not null;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
--
-- Unified across every way somebody arrives: a listing inquiry, the contact
-- form, a referral, outbound. One table rather than one per channel, because
-- the question a broker asks in the morning is "who do I call today" and the
-- answer must not depend on which form they came through.

create table public.leads (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid references public.firms (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,

  -- The person. Restricted rather than cascaded: deleting a contact should not
  -- silently take the pipeline history with it.
  contact_id uuid not null references public.contacts (id) on delete restrict,

  -- What they were interested in, if anything. `on delete set null`: a lead
  -- outlives the listing that produced it, and often becomes a lead on the next
  -- one.
  listing_id uuid references public.listings (id) on delete set null,

  source app.lead_source not null default 'manual',
  status app.lead_status not null default 'new',
  stage_id uuid references public.pipeline_stages (id) on delete set null,

  -- Who is working it. Null means unassigned, which is a real state and the one
  -- a morning stand-up is about.
  assigned_to uuid references auth.users (id) on delete set null,

  -- What they said when they arrived. Plain text, rendered as plain text.
  message text check (message is null or char_length(message) <= 4000),

  -- Set when the lead becomes a deal, so "how many inquiries turn into
  -- something" is answerable without reconstructing it from the audit log.
  converted_deal_id uuid references public.deals (id) on delete set null,
  converted_at timestamptz,

  last_contacted_at timestamptz,
  next_action_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leads_has_one_owner check ((firm_id is null) <> (owner_id is null)),
  constraint leads_converted_has_timestamp check (
    status <> 'converted' or converted_at is not null
  )
);

create index leads_firm_idx on public.leads (firm_id, status);
create index leads_owner_idx on public.leads (owner_id, status);
create index leads_assigned_idx on public.leads (assigned_to) where status not in ('converted', 'unqualified');
create index leads_next_action_idx on public.leads (next_action_at) where next_action_at is not null;
create index leads_contact_idx on public.leads (contact_id);

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Notes and tasks
-- ---------------------------------------------------------------------------

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),

  -- Attached to one of the two. Both nullable and at most one set: a note about
  -- a person outlives any particular lead, and a note about a lead is about
  -- that conversation.
  contact_id uuid references public.contacts (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,

  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 8000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_notes_has_subject check (
    contact_id is not null or lead_id is not null
  )
);

create index crm_notes_contact_idx on public.crm_notes (contact_id, created_at desc);
create index crm_notes_lead_idx on public.crm_notes (lead_id, created_at desc);

create trigger crm_notes_touch_updated_at
  before update on public.crm_notes
  for each row execute function app.touch_updated_at();

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid references public.firms (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,

  contact_id uuid references public.contacts (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,

  title text not null check (char_length(trim(title)) between 1 and 300),
  detail text check (detail is null or char_length(detail) <= 4000),

  assigned_to uuid references auth.users (id) on delete set null,
  due_at timestamptz,

  status app.task_status not null default 'open',
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_tasks_has_one_owner check ((firm_id is null) <> (owner_id is null)),
  constraint crm_tasks_done_has_timestamp check (
    status <> 'done' or completed_at is not null
  )
);

create index crm_tasks_assigned_idx
  on public.crm_tasks (assigned_to, due_at) where status = 'open';
create index crm_tasks_firm_idx on public.crm_tasks (firm_id, status);
create index crm_tasks_owner_idx on public.crm_tasks (owner_id, status);

create trigger crm_tasks_touch_updated_at
  before update on public.crm_tasks
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- Completion is stamped, not accepted
-- ===========================================================================
--
-- Same rule as NDA signature, outreach approval and commission settlement: a
-- record of who did something, written by whoever claims it was done, is not a
-- record of anything.

create or replace function app.stamp_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
    new.completed_by := auth.uid();
  end if;

  if new.status <> 'done' then
    new.completed_at := null;
    new.completed_by := null;
  end if;

  return new;
end;
$$;

create trigger crm_tasks_stamp_completion
  before update on public.crm_tasks
  for each row execute function app.stamp_task_completion();

-- ===========================================================================
-- Access
-- ===========================================================================

/*
 * Whether a CRM row belongs to the caller's world.
 *
 * One helper for every table here, because the ownership rule is identical and
 * writing it out five times is five chances to write it differently. Takes both
 * columns because the check constraint guarantees exactly one is set.
 *
 * `SECURITY DEFINER` for the usual reason — `app.is_firm_member` reads
 * `firm_members`, which restricts a caller to their own rows, and a policy's
 * subqueries run under the target table's RLS.
 */
create or replace function app.owns_crm_row(target_firm_id uuid, target_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when target_firm_id is not null then app.is_firm_member(target_firm_id)
    else target_owner_id = auth.uid()
  end;
$$;

/*
 * The same question for a note, which has no ownership columns of its own.
 *
 * A note hangs off a contact or a lead and inherits their boundary. Resolving
 * that inline in the policy would subquery `contacts` under its own RLS, which
 * works here and would stop working the day the contact policy gains a
 * condition the note does not share — so it is a definer function like
 * everything else, and the rule lives in one place.
 */
create or replace function app.owns_crm_note(target_contact_id uuid, target_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    coalesce(
      (select app.owns_crm_row(c.firm_id, c.owner_id)
         from public.contacts c where c.id = target_contact_id),
      false
    )
    or coalesce(
      (select app.owns_crm_row(l.firm_id, l.owner_id)
         from public.leads l where l.id = target_lead_id),
      false
    );
$$;

revoke all on function app.owns_crm_row(uuid, uuid) from public, anon;
revoke all on function app.owns_crm_note(uuid, uuid) from public, anon;
grant execute on function app.owns_crm_row(uuid, uuid) to authenticated;
grant execute on function app.owns_crm_note(uuid, uuid) to authenticated;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.contacts enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.crm_notes enable row level security;
alter table public.crm_tasks enable row level security;

alter table public.contacts force row level security;
alter table public.pipeline_stages force row level security;
alter table public.leads force row level security;
alter table public.crm_notes force row level security;
alter table public.crm_tasks force row level security;

/*
 * A CRM is the most commercially sensitive thing a brokerage owns — it *is* the
 * business. Two brokers at different firms sharing this platform must never see
 * one another's pipeline, and unlike a listing there is no half of a contact
 * that is safe to show.
 *
 * So there is no admin branch on any of these. Platform operations verifies
 * people and moderates listings; it has no business reading who a brokerage is
 * talking to, and adding an admin escape hatch "for support" is how that stops
 * being true.
 */
create policy contacts_own on public.contacts
  for all to authenticated
  using (app.owns_crm_row(firm_id, owner_id))
  with check (app.owns_crm_row(firm_id, owner_id));

create policy pipeline_stages_own on public.pipeline_stages
  for all to authenticated
  using (app.owns_crm_row(firm_id, owner_id))
  with check (app.owns_crm_row(firm_id, owner_id));

create policy leads_own on public.leads
  for all to authenticated
  using (app.owns_crm_row(firm_id, owner_id))
  with check (app.owns_crm_row(firm_id, owner_id));

create policy crm_notes_own on public.crm_notes
  for all to authenticated
  using (app.owns_crm_note(contact_id, lead_id))
  with check (app.owns_crm_note(contact_id, lead_id));

create policy crm_tasks_own on public.crm_tasks
  for all to authenticated
  using (app.owns_crm_row(firm_id, owner_id))
  with check (app.owns_crm_row(firm_id, owner_id));

-- ===========================================================================
-- A working board on day one
-- ===========================================================================
--
-- Seeded by the database rather than by the application, so a firm that never
-- opens the settings page still has somewhere to put a lead — and so the
-- default set is one definition rather than one per code path that needs it.
--
-- Idempotent: calling it twice does nothing the second time, which matters
-- because the natural place to call it is "whenever the board looks empty".

create or replace function public.seed_pipeline_stages(target_firm_id uuid default null)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  inserted integer;
  target_owner uuid;
begin
  if target_firm_id is null then
    target_owner := auth.uid();
  end if;

  -- Invoker rights, so the insert below goes through `pipeline_stages_own`.
  -- Somebody calling this with another firm's id inserts nothing.
  insert into public.pipeline_stages (firm_id, owner_id, name, position, is_terminal, is_won)
  select target_firm_id, target_owner, s.name, s.position, s.is_terminal, s.is_won
    from (values
      ('New',            0::smallint, false, false),
      ('Contacted',      1::smallint, false, false),
      ('Qualified',      2::smallint, false, false),
      ('Engaged',        3::smallint, false, false),
      ('Under LOI',      4::smallint, false, false),
      ('Closed won',     5::smallint, true,  true),
      ('Closed lost',    6::smallint, true,  false)
    ) as s(name, position, is_terminal, is_won)
   where not exists (
     select 1 from public.pipeline_stages p
      where p.firm_id is not distinct from target_firm_id
        and p.owner_id is not distinct from target_owner
   );

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.seed_pipeline_stages(uuid) from public, anon;
grant execute on function public.seed_pipeline_stages(uuid) to authenticated;

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- DELETE is granted here, unlike almost everywhere else in this schema, and the
-- distinction is worth stating: an NDA, a commission record and an audit entry
-- are records of things that happened to other people. A contact entered by
-- mistake is the firm's own working data, and a CRM you cannot tidy is a CRM
-- people stop using — which costs more than the deletion does.
--
-- Leads keep DELETE for the same reason. What they do not get is silent
-- deletion of the contact underneath them: `on delete restrict` on
-- `leads.contact_id` means tidying a contact with history is a deliberate act.

grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.pipeline_stages to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.crm_notes to authenticated;
grant select, insert, update, delete on public.crm_tasks to authenticated;
