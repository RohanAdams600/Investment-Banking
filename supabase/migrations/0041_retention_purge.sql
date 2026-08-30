-- Deleting the confidential half once a deal is over.
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
--
-- A breach can only expose what is still held. Every listing that closes or is
-- withdrawn leaves behind the most sensitive rows in the schema — the company's
-- real name and address, its exact revenue and earnings, its customer
-- concentration — for a business that is no longer for sale and a buyer who is
-- no longer looking. Keeping it forever means the value of breaching this
-- platform rises every year it operates, for no benefit to anybody.
--
-- Ninety days after a listing reaches `closed` or `withdrawn`, that half is
-- deleted. The teaser survives, the status history survives, and the audit
-- trail survives — so the record of what happened is intact and the
-- confidential material behind it is gone.
--
-- Ninety rather than thirty because deals stall and restart constantly in this
-- market: a seller who withdraws in March and relists in May would otherwise
-- find their financials deleted underneath them.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT purged
-- ---------------------------------------------------------------------------
--
--   * The listing row itself. The public teaser is anonymised by construction
--     and is what makes a closed sale part of the market's history.
--   * `listing_status_history` and `audit_events`. Deleting the record of a
--     deletion defeats the point of having one.
--   * Deal documents. They belong to a deal rather than a listing, have their
--     own participants and their own lifecycle, and a file the buyer's lender
--     relied on is not this function's to remove. That is a separate policy and
--     it is written down as an open item rather than quietly assumed handled.
--
-- ---------------------------------------------------------------------------
-- It reports what it did
-- ---------------------------------------------------------------------------
--
-- A silent purge is indistinguishable from a purge that never ran, and this is
-- the kind of job that fails quietly for months. It returns counts, and it
-- writes an audit event per listing so "what happened to that data" has an
-- answer years later.

create or replace function app.purge_expired_confidential_data(retention_days integer default 90)
returns table (listings_purged integer, details_deleted integer, financial_years_deleted integer)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(coalesce(retention_days, 90), 1));
  target record;
  purged integer := 0;
  details integer := 0;
  years integer := 0;
  removed integer;
begin
  for target in
    /*
     * Listings that reached a terminal status before the cutoff and have not
     * moved since. `changed_at` from the history rather than `updated_at` on
     * the listing: `updated_at` moves for any edit, so a seller correcting a
     * typo on a withdrawn listing would restart the clock forever.
     */
    select l.id
      from public.listings l
     where l.status in ('closed', 'withdrawn')
       and exists (
         select 1 from public.listing_status_history h
          where h.listing_id = l.id
            and h.to_status = l.status
            and h.changed_at < cutoff
       )
       and (
         exists (select 1 from public.listing_details d where d.listing_id = l.id)
         or exists (select 1 from public.listing_financials f where f.listing_id = l.id)
       )
  loop
    delete from public.listing_details where listing_id = target.id;
    get diagnostics removed = row_count;
    details := details + removed;

    delete from public.listing_financials where listing_id = target.id;
    get diagnostics removed = row_count;
    years := years + removed;

    purged := purged + 1;

    /*
     * Recorded against the listing, with no actor: nobody performed this, time
     * did. `audit_log` is append-only and is not itself purged, so the fact
     * that the data was deleted outlives the data.
     *
     * `entity_id` is text on this table rather than uuid, so the cast is
     * explicit — an implicit one would work today and break the day somebody
     * changes the column.
     */
    insert into public.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
    values (
      null,
      'listing.confidential_data_purged',
      'listing',
      target.id::text,
      jsonb_build_object('retention_days', retention_days, 'purged_at', now())
    );
  end loop;

  return query select purged, details, years;
end;
$fn$;

revoke all on function app.purge_expired_confidential_data(integer) from public, anon, authenticated;

comment on function app.purge_expired_confidential_data(integer) is
  'Deletes the confidential half of listings that closed or were withdrawn more than retention_days ago. Service-role only. Keeps the teaser, the status history and the audit trail.';

/*
 * A dry run, so the schedule can be trusted before it is armed.
 *
 * Returns what *would* go, without deleting anything. Anybody wiring up a
 * deletion job should be able to look at the list first — and a purge nobody
 * has previewed is a purge nobody will notice is wrong until it is.
 */
create or replace function app.confidential_purge_preview(retention_days integer default 90)
returns table (listing_id uuid, status text, terminal_at timestamptz, detail_rows bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select l.id,
         l.status::text,
         (select max(h.changed_at) from public.listing_status_history h
           where h.listing_id = l.id and h.to_status = l.status),
         (select count(*) from public.listing_details d where d.listing_id = l.id)
           + (select count(*) from public.listing_financials f where f.listing_id = l.id)
    from public.listings l
   where l.status in ('closed', 'withdrawn')
     and exists (
       select 1 from public.listing_status_history h
        where h.listing_id = l.id
          and h.to_status = l.status
          and h.changed_at < now() - make_interval(days => greatest(coalesce(retention_days, 90), 1))
     )
     and (
       exists (select 1 from public.listing_details d where d.listing_id = l.id)
       or exists (select 1 from public.listing_financials f where f.listing_id = l.id)
     )
   order by 3;
$fn$;

revoke all on function app.confidential_purge_preview(integer) from public, anon, authenticated;

comment on function app.confidential_purge_preview(integer) is
  'What purge_expired_confidential_data would delete, without deleting it. Service-role only.';
