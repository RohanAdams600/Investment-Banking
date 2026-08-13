-- Revision history for legal drafts.
--
-- Drafting a document is the easy half. The half that eats weeks in a real
-- transaction is the third round of redlines, where somebody has to work out
-- what moved between version four and version five and whether they agreed to
-- it.
--
-- So a revision is never an overwrite. `legal_document_drafts.body` holds the
-- current text; every text it has ever held is here. The diff between any two is
-- computed on read from the bodies — deterministic, so storing it would be a
-- second copy of the same fact and a chance for the two to disagree.
--
-- Append-only, like `consent_records` and the audit log, and for the same
-- reason: the value of a revision history is entirely in the guarantee that
-- nobody edited it afterwards. A history that can be rewritten answers no
-- question worth asking.

create table public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),

  draft_id uuid not null references public.legal_document_drafts (id) on delete cascade,

  -- Sequential per draft, starting at 1. Assigned by the trigger below rather
  -- than by the client, so two people revising at once cannot both claim v4.
  version integer not null check (version > 0),

  body text not null,

  -- Who made this revision, and what they said about it. Free text, because
  -- "buyer's counsel returned this" is more useful than any enum we could
  -- invent.
  created_by uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 1000),

  -- What the review checklist said about *this* version. A review run against
  -- version three says nothing about version four, and keeping the findings
  -- with the version they describe is what stops somebody reading a stale one.
  review_findings jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  unique (draft_id, version)
);

create index legal_document_versions_draft_idx
  on public.legal_document_versions (draft_id, version desc);

-- ===========================================================================
-- Version numbering
-- ===========================================================================
--
-- Assigned server-side. A client-supplied number is a race: two people revising
-- the same draft in the same minute both read "3" and both write "4", and the
-- unique constraint turns one of them into an error the user cannot act on.
create or replace function app.assign_document_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  select coalesce(max(v.version), 0) + 1
    into new.version
    from public.legal_document_versions v
   where v.draft_id = new.draft_id;

  -- Stamped, never accepted. Attribution somebody else can write is not
  -- attribution.
  new.created_by := auth.uid();

  return new;
end;
$$;

create trigger legal_document_versions_assign_version
  before insert on public.legal_document_versions
  for each row execute function app.assign_document_version();

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.legal_document_versions enable row level security;
alter table public.legal_document_versions force row level security;

/*
 * Visible to whoever can see the draft.
 *
 * The subquery reads `legal_document_drafts`, which has its own RLS — and this
 * time that is exactly what is wanted rather than a bug. The draft's policy is
 * the definition of who may see the document, so deferring to it means the two
 * cannot drift. Contrast `app.is_my_counterparty()`, where the inner table's
 * policy deliberately hides the rows from the caller and a definer was needed.
 */
create policy legal_document_versions_select on public.legal_document_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.legal_document_drafts d
       where d.id = public.legal_document_versions.draft_id
    )
  );

create policy legal_document_versions_insert on public.legal_document_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.legal_document_drafts d
       where d.id = public.legal_document_versions.draft_id
         and d.created_by = auth.uid()
    )
  );

-- No update or delete policy, and no grant. Append-only is the whole point.

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select, insert on public.legal_document_versions to authenticated;
