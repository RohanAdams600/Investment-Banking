-- The document vault.
--
-- ---------------------------------------------------------------------------
-- Why this is not the attachments table
-- ---------------------------------------------------------------------------
--
-- 0012 already stores files: an attachment is something somebody sent in a
-- conversation, and it inherits that conversation's membership exactly. That is
-- the right model for "here is the thing I was talking about" and the wrong one
-- for diligence.
--
-- A diligence document belongs to the *deal*, not to a message. It is filed
-- under a category, it is superseded rather than resent, and — the part the
-- attachment model cannot express — it is often released to one party and not
-- another. A seller with three bidders in the same room does not hand all three
-- their tax returns on the same day, and the one who signed first should not
-- see what the third one asked for.
--
-- So `document:upload`, `document:download` and `document:set_permissions` have
-- been in the capability catalog since step 2 with nothing enforcing them. This
-- migration is where they stop being aspirational.
--
-- ---------------------------------------------------------------------------
-- Three levels, and why not more
-- ---------------------------------------------------------------------------
--
-- `visibility` is deliberately coarse. Every per-document permission scheme
-- grows towards a matrix nobody can reason about, and a permission model a
-- seller cannot hold in their head is one they will get wrong under time
-- pressure — which is exactly when the confidential file goes to the wrong
-- bidder. Three levels, each a sentence:
--
--   - `private`      — only me and my side. Staging, before it is released.
--   - `restricted`   — the people I have named. The default for anything real.
--   - `deal`         — everybody in the room.
--
-- Anything finer is expressed by naming fewer people, not by adding a level.

create type app.document_visibility as enum ('private', 'restricted', 'deal');

create type app.document_category as enum (
  'financial_statement',
  'tax_return',
  'legal',
  'contract',
  'lease',
  'operational',
  'insurance',
  'employee',
  'customer',
  'other'
);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table public.deal_documents (
  id uuid primary key default gen_random_uuid(),

  deal_id uuid not null references public.deals (id) on delete cascade,

  -- Which side put it in. Not `on delete cascade`: a document somebody relied
  -- on during diligence does not vanish because they closed their account.
  uploaded_by uuid references auth.users (id) on delete set null,
  -- The firm the uploader was acting for, so "my side" survives a personnel
  -- change. Null for an unaffiliated seller or buyer.
  firm_id uuid references public.firms (id) on delete set null,

  title text not null check (char_length(trim(title)) between 1 and 300),
  category app.document_category not null default 'other',
  visibility app.document_visibility not null default 'restricted',

  /*
   * The object in `deal-documents`, as `<deal_id>/<document_id>/<file_name>`.
   *
   * Stored rather than derived because the file name is part of it and file
   * names are not reconstructible. The storage policy reads the *second* path
   * segment and checks it against this table, which is what puts the object
   * behind the same rule as its row.
   */
  storage_path text not null unique check (char_length(storage_path) <= 1000),
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null check (char_length(content_type) <= 200),
  size_bytes bigint not null check (size_bytes >= 0),

  -- A new upload supersedes an old one rather than overwriting it. Diligence
  -- runs on "which version did I review", and an answer that changed under
  -- somebody is worse than no answer.
  replaces_document_id uuid references public.deal_documents (id) on delete set null,
  superseded_at timestamptz,

  -- Withdrawn rather than deleted, for the same reason messages are. The row
  -- and the audit trail around it stay; access stops.
  withdrawn_at timestamptz,
  withdrawn_reason text check (withdrawn_reason is null or char_length(withdrawn_reason) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deal_documents_deal_idx
  on public.deal_documents (deal_id, category)
  where withdrawn_at is null and superseded_at is null;

create index deal_documents_uploader_idx on public.deal_documents (uploaded_by);
create index deal_documents_supersedes_idx on public.deal_documents (replaces_document_id);

create trigger deal_documents_touch_updated_at
  before update on public.deal_documents
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Who a restricted document was released to
-- ---------------------------------------------------------------------------
--
-- Rows here are a record of a release, not a toggle. Revoking sets
-- `revoked_at`; it does not delete, because "was this person ever shown the
-- customer list" is a question that gets asked after a deal falls apart, and a
-- deleted row answers it wrongly.

create table public.document_grants (
  id uuid primary key default gen_random_uuid(),

  document_id uuid not null references public.deal_documents (id) on delete cascade,
  grantee_id uuid not null references auth.users (id) on delete cascade,

  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,

  -- One live grant per person per document. A re-grant after revocation
  -- updates this row, and the audit log carries the sequence.
  unique (document_id, grantee_id)
);

create index document_grants_grantee_idx
  on public.document_grants (grantee_id)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Who actually opened it
-- ---------------------------------------------------------------------------
--
-- The single most requested thing a seller wants from a data room, and the
-- thing that makes releasing a document survivable: not "who could have read
-- the tax returns" but "who did, and when".
--
-- Written server-side with the service role when a signed URL is minted, the
-- same way `audit_log` is written — a client that could write here could
-- fabricate a read, or omit their own. Unlike `audit_log`, this one is readable
-- by the document's owner, because it is their evidence and not the platform's.
--
-- Worth being precise about what it records: a signed URL was issued to this
-- person for this document. Whether the bytes arrived, and whether they were
-- then forwarded, is outside what any server can observe.

create table public.document_access_log (
  id bigint generated always as identity primary key,

  document_id uuid not null references public.deal_documents (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,

  -- 'download' when a URL was issued, 'view' for a preview, 'denied' for a
  -- request that was refused — the last one is the interesting row when
  -- somebody is probing.
  action text not null check (action in ('download', 'view', 'denied')),

  ip_address inet,
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),

  created_at timestamptz not null default now()
);

create index document_access_log_document_idx
  on public.document_access_log (document_id, created_at desc);

-- ===========================================================================
-- Access
-- ===========================================================================

/*
 * Whether the caller may read a document.
 *
 * `SECURITY DEFINER` for the reason that has now caught this codebase four
 * times: a policy's subqueries run under the target table's RLS. Written inline
 * on `deal_documents`, the `document_grants` lookup would recurse into a policy
 * that itself needs to know whether the caller can read the document.
 *
 * Deal membership is necessary in every branch — a grant to somebody outside
 * the room does not admit them, which matters because a grant outlives the
 * membership that justified it.
 */
create or replace function app.can_read_document(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from public.deal_documents d
     where d.id = target_document_id
       and d.withdrawn_at is null
       and app.can_access_deal(d.deal_id)
       and (
         -- Mine, whatever its visibility.
         d.uploaded_by = auth.uid()
         -- My side's. A colleague uploading to the room does not have to
         -- re-share it with their own firm.
         or (d.firm_id is not null and app.is_firm_member(d.firm_id))
         -- Released to the room.
         or d.visibility = 'deal'
         -- Released to me by name.
         or (
           d.visibility = 'restricted'
           and exists (
             select 1 from public.document_grants g
              where g.document_id = d.id
                and g.grantee_id = auth.uid()
                and g.revoked_at is null
           )
         )
       )
  );
$$;

/*
 * Whether the caller controls a document — may re-file it, release it, or
 * withdraw it.
 *
 * Narrower than reading, and deliberately not "anybody in the deal". A buyer
 * who can see a seller's tax return must not be able to hand it to the other
 * bidder, and without this that is exactly what `document:set_permissions`
 * would allow.
 */
create or replace function app.controls_document(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from public.deal_documents d
     where d.id = target_document_id
       and (
         d.uploaded_by = auth.uid()
         or (d.firm_id is not null and app.is_firm_administrator(d.firm_id))
       )
  );
$$;

/*
 * The storage-policy half.
 *
 * Takes text rather than uuid because it is fed a path segment, and a path is
 * whatever the caller named the object. `<deal_id>/<document_id>/<file>` with a
 * malformed middle segment must return false, not raise — a policy that throws
 * on bad input is a denial-of-service on every other object in the bucket.
 */
create or replace function app.can_read_document_path(segment text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  parsed uuid;
begin
  begin
    parsed := segment::uuid;
  exception when others then
    return false;
  end;

  return app.can_read_document(parsed);
end;
$$;

revoke all on function app.can_read_document(uuid) from public, anon;
revoke all on function app.controls_document(uuid) from public, anon;
revoke all on function app.can_read_document_path(text) from public, anon;
grant execute on function app.can_read_document(uuid) to authenticated;
grant execute on function app.controls_document(uuid) to authenticated;
grant execute on function app.can_read_document_path(text) to authenticated;

-- ===========================================================================
-- Immutability
-- ===========================================================================

/*
 * What a document is, and where its bytes are, do not change.
 *
 * Same technique as the listing and profile triggers: copy the new row,
 * normalise the fields that are allowed to move, compare against the old. A
 * whole-row comparison catches a column added next year that nobody thought to
 * protect.
 *
 * The point is narrow and important. Without it, "set permissions" and "change
 * the file this row points at" are the same grant — so a party could release a
 * harmless document, wait for it to be reviewed, and then repoint the row. The
 * audit log would show a release of the reviewed document and a download of
 * something else.
 */
create or replace function app.freeze_document_immutables()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  probe public.deal_documents;
begin
  probe := new;

  probe.title := old.title;
  probe.category := old.category;
  probe.visibility := old.visibility;
  probe.superseded_at := old.superseded_at;
  probe.withdrawn_at := old.withdrawn_at;
  probe.withdrawn_reason := old.withdrawn_reason;
  probe.updated_at := old.updated_at;

  if probe is distinct from old then
    raise exception 'A document''s file, deal and uploader are fixed; upload a new version instead'
      using errcode = '42501';
  end if;

  -- Withdrawal is one-way. Un-withdrawing would restore access to something
  -- somebody was told had been pulled.
  if old.withdrawn_at is not null and new.withdrawn_at is null then
    raise exception 'A withdrawn document cannot be restored'
      using errcode = '42501';
  end if;

  if new.withdrawn_at is not null and old.withdrawn_at is null then
    new.withdrawn_at := now();
  end if;

  return new;
end;
$$;

create trigger deal_documents_freeze_immutables
  before update on public.deal_documents
  for each row execute function app.freeze_document_immutables();

/*
 * A grant records who did the granting, and when.
 *
 * Stamped rather than accepted, so a release cannot be attributed to somebody
 * who did not make it — the same rule as outreach approval and NDA signature.
 */
create or replace function app.stamp_document_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.granted_by := auth.uid();
    new.granted_at := now();
    new.revoked_at := null;
    new.revoked_by := null;
    return new;
  end if;

  if new.document_id <> old.document_id or new.grantee_id <> old.grantee_id then
    raise exception 'A grant cannot be moved to another document or person'
      using errcode = '42501';
  end if;

  if new.revoked_at is not null and old.revoked_at is null then
    new.revoked_at := now();
    new.revoked_by := auth.uid();
  end if;

  -- Re-granting after a revocation is a new release, and gets a new timestamp.
  if new.revoked_at is null and old.revoked_at is not null then
    new.granted_by := auth.uid();
    new.granted_at := now();
    new.revoked_by := null;
  end if;

  return new;
end;
$$;

create trigger document_grants_stamp
  before insert or update on public.document_grants
  for each row execute function app.stamp_document_grant();

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.deal_documents enable row level security;
alter table public.document_grants enable row level security;
alter table public.document_access_log enable row level security;

alter table public.deal_documents force row level security;
alter table public.document_grants force row level security;
alter table public.document_access_log force row level security;

/*
 * Reading a row is reading that the document exists, its title and its
 * category. That is the same disclosure as reading the file, so it is the same
 * check — a title like "Q3 layoffs memo" is not metadata.
 *
 * The `controls_document` branch is not a widening; it is what makes withdrawal
 * work. `can_read_document` excludes withdrawn documents, and Postgres applies
 * SELECT policies to `UPDATE ... WHERE` — so without this branch, withdrawing a
 * document made its own row unreachable to the person who withdrew it, and the
 * next update matched zero rows rather than being refused. Which is the worst
 * kind of failure: silent, and indistinguishable from success.
 *
 * It is also the honest model. A withdrawn document stays part of the record of
 * what was disclosed and when it was pulled, and the owner is exactly who needs
 * to see that. Everybody else loses access the moment it is withdrawn.
 */
create policy deal_documents_select on public.deal_documents
  for select to authenticated
  using (app.can_read_document(id) or app.controls_document(id));

/*
 * Uploading requires membership of the deal, and attribution to yourself.
 *
 * No capability check here: RLS cannot see the capability catalog, and a
 * duplicate of it in SQL would be a second copy to drift. The API layer checks
 * `document:upload` and this checks that whoever got through is a member acting
 * as themselves. Two layers, different questions.
 */
create policy deal_documents_insert on public.deal_documents
  for insert to authenticated
  with check (
    app.can_access_deal(deal_id)
    and uploaded_by = auth.uid()
    and (firm_id is null or app.is_firm_member(firm_id))
  );

create policy deal_documents_update_controller on public.deal_documents
  for update to authenticated
  using (app.controls_document(id))
  with check (app.controls_document(id));

-- No delete policy. A document in a data room is part of the record of what was
-- disclosed; withdrawing it is a status, not a disappearance.

-- A grant is visible to the person who made it and the person it names. The
-- grantee seeing their own access is the difference between "you may read this"
-- and "you may read this, and you can check that".
create policy document_grants_select on public.document_grants
  for select to authenticated
  using (grantee_id = auth.uid() or app.controls_document(document_id));

create policy document_grants_write on public.document_grants
  for insert to authenticated
  with check (app.controls_document(document_id));

create policy document_grants_update on public.document_grants
  for update to authenticated
  using (app.controls_document(document_id))
  with check (app.controls_document(document_id));

/*
 * The access log is the uploader's evidence.
 *
 * Readable by whoever controls the document, and by the person whose reads it
 * records — you are entitled to see what the platform logged about you.
 * Deliberately not readable by everybody in the deal: who else is looking at
 * the tax returns, and how often, is a negotiating signal.
 */
create policy document_access_log_select on public.document_access_log
  for select to authenticated
  using (actor_id = auth.uid() or app.controls_document(document_id));

-- No insert, update or delete policy. Entries are written with the service
-- role at the moment a URL is issued. A client that could write here could
-- fabricate a read, or quietly omit their own.

-- ===========================================================================
-- Storage
-- ===========================================================================
--
-- A second bucket rather than a folder in `deal-attachments`, because the two
-- have different access rules and a shared bucket would need one policy that
-- expresses both. `public = false`, so no object has a permanent URL.
--
-- Object paths are `<deal_id>/<document_id>/<file_name>`. The read policy
-- checks the *document* id against `deal_documents`, so per-document releases
-- reach the object and not just the row.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-documents',
  'deal-documents',
  false,
  104857600, -- 100 MB. Diligence packs are bigger than chat attachments.
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy deal_documents_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deal-documents'
    and app.can_read_document_path(split_part(name, '/', 2))
  );

/*
 * Uploads are checked against the deal, not the document.
 *
 * The row is written first and the object second, so at insert time the
 * document exists — but the two are separate statements and a failure between
 * them leaves a row with no file. That is the safe direction: a row with no
 * object is a broken listing entry, whereas an object with no row is a file in
 * a bucket that no policy describes.
 */
create policy deal_documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'deal-documents'
    and owner_id = auth.uid()::text
    and app.can_read_document_path(split_part(name, '/', 2))
  );

-- No update or delete policy. Superseding uploads a new object; withdrawing
-- stops access to the existing one. Neither removes bytes an audit entry points
-- at.

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select, insert, update on public.deal_documents to authenticated;
grant select, insert, update on public.document_grants to authenticated;
grant select on public.document_access_log to authenticated;
