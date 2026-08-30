-- View-only documents, with a per-deal release the uploader controls.
--
-- ---------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------
--
-- Documents in a deal room are now view-only by default: they render in the
-- browser through a server route that watermarks them, and no file reaches the
-- viewer's disk. The uploader may release downloads for a deal they have come
-- to trust.
--
-- Blocked-by-default is the operator's call and it has a real cost, which is
-- worth writing down rather than discovering later: a buyer's accountant
-- genuinely needs to work through a profit-and-loss statement offline, and some
-- institutional buyers will refuse to run diligence any other way. The release
-- switch exists so that costs you a conversation rather than the deal.
--
-- ---------------------------------------------------------------------------
-- Why the flag sits on the document and not on the deal
-- ---------------------------------------------------------------------------
--
-- A deal has two sides and both of them upload. A single flag on `deals` would
-- let one party's choice govern the other party's files — the seller relaxing
-- their own documents would also relax the buyer's funding letters, which is
-- not the seller's decision to make.
--
-- So the flag is per document and controlled by `app.controls_document()`,
-- which is the uploader or an administrator of their firm: whoever's
-- information it is decides who may keep a copy. The application offers a
-- "release everything in this deal" action so it still feels per-deal to use.
--
-- ---------------------------------------------------------------------------
-- Nothing here stops a determined copy
-- ---------------------------------------------------------------------------
--
-- A screenshot exists. View-only raises the effort and removes the accidents —
-- the forwarded attachment, the file left in a downloads folder, the laptop
-- that gets sold. The watermark is what addresses the deliberate case, by
-- making a leaked page trace back to the account that opened it. Neither is a
-- guarantee and the product does not claim one.

alter table public.deal_documents
  add column if not exists downloads_allowed boolean not null default false;

comment on column public.deal_documents.downloads_allowed is
  'False means the file may be viewed in the browser but never downloaded. Set by whoever controls the document - the party whose information it is - not by whoever wants to read it.';

/*
 * The immutability trigger has to learn about the new column.
 *
 * `freeze_document_immutables` works by copying `new`, resetting the columns a
 * caller is allowed to change back to their old values, and refusing if
 * anything still differs. A column it has never heard of is therefore frozen by
 * default — which is the safe direction to fail, and also means adding a
 * settable column silently does nothing until this function is re-emitted.
 *
 * The same shape caused a live bug in 0036, where a generated column made every
 * moderation look like a rewrite. Re-emitted here in full rather than patched,
 * so the whole list of mutable columns is readable in one place.
 */
create or replace function app.freeze_document_immutables()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
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
  -- New in 0040. The uploader may release or re-restrict downloads at any time.
  probe.downloads_allowed := old.downloads_allowed;

  if probe is distinct from old then
    raise exception 'A document''s file, deal and uploader are fixed; upload a new version instead'
      using errcode = '42501';
  end if;

  if old.withdrawn_at is not null and new.withdrawn_at is null then
    raise exception 'A withdrawn document cannot be restored'
      using errcode = '42501';
  end if;

  if new.withdrawn_at is not null and old.withdrawn_at is null then
    new.withdrawn_at := now();
  end if;

  return new;
end;
$fn$;

/*
 * Reading the flag is not the same as being allowed to change it.
 *
 * `deal_documents_update_controller` already restricts UPDATE to
 * `app.controls_document()`, so a buyer cannot flip their counterparty's
 * documents open. This function exists so the *application* can ask the
 * question cheaply on a page render without re-deriving the rule, and so the
 * answer is the same everywhere it is asked.
 *
 * SECURITY INVOKER: a caller who cannot see the document row cannot learn
 * anything about it here either.
 */
create or replace function public.document_downloads_allowed(target_document_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $fn$
  select coalesce(
    (select d.downloads_allowed
       from public.deal_documents d
      where d.id = target_document_id
        and d.withdrawn_at is null),
    false
  );
$fn$;

revoke all on function public.document_downloads_allowed(uuid) from public, anon;
grant execute on function public.document_downloads_allowed(uuid) to authenticated;

comment on function public.document_downloads_allowed(uuid) is
  'Whether this document may leave the browser. False for a withdrawn document and false when the row is not visible to the caller, so it fails closed.';
