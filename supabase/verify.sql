-- ===========================================================================
-- Did it actually land?
-- ===========================================================================
--
-- Run this in the SQL Editor after pasting supabase/bundle.sql. Every row must
-- say PASS.
--
-- This exists because a dashboard paste has silently applied nothing in this
-- project before while reporting success — 0027 was pasted, reported as run, and
-- had rewritten zero of 38 policies. A partly-applied schema looks identical to
-- a working one until something reads a column that is not there, and by then
-- the failure surfaces as a broken page rather than a migration error.
--
-- So this asks the database what it contains rather than trusting what the
-- editor said.

with checks as (

  -- 0030: the business history, split across both halves of a listing
  select '0030 listings.background' as check_name,
         to_regclass('public.listings') is not null
         and exists (select 1 from information_schema.columns
                      where table_name = 'listings' and column_name = 'background') as ok
  union all
  select '0030 listing_details.ownership_history',
         exists (select 1 from information_schema.columns
                  where table_name = 'listing_details' and column_name = 'ownership_history')

  -- 0031: paid placement
  union all
  select '0031 listing_promotions table', to_regclass('public.listing_promotions') is not null
  union all
  select '0031 active_promotion_rank()',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'active_promotion_rank')
  union all
  select '0031 a seller cannot self-promote',
         exists (select 1 from pg_policies
                  where tablename = 'listing_promotions'
                    and policyname = 'listing_promotions_insert_admin')

  -- 0032: MCP agent credentials
  union all
  select '0032 mcp_tokens table', to_regclass('public.mcp_tokens') is not null
  union all
  select '0032 resolve_mcp_token() in public',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'resolve_mcp_token')
  union all
  select '0032 no scope means send',
         not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                      where t.typname = 'mcp_scope'
                        and e.enumlabel ~ 'send|publish|issue|approve')

  -- 0033: email delivery
  union all
  select '0033 email_deliveries table', to_regclass('public.email_deliveries') is not null
  union all
  select '0033 unsubscribe_token column',
         exists (select 1 from information_schema.columns
                  where table_name = 'notification_preferences'
                    and column_name = 'unsubscribe_token')
  union all
  select '0033 anon may unsubscribe',
         has_function_privilege('anon',
           (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'unsubscribe_by_token'), 'EXECUTE')

  -- 0034: the pre-launch capture
  union all
  select '0034 market_interest table', to_regclass('public.market_interest') is not null
  union all
  select '0034 market_is_open()',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'market_is_open')
  union all
  select '0034 interest is write-only for clients',
         not exists (select 1 from pg_policies
                      where tablename = 'market_interest' and cmd = 'SELECT'
                        and qual not like '%is_platform_admin%')

  union all
  select '0037 buyer verification table exists',
         exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename = 'buyer_verifications')
  union all
  -- The claim the whole feature rests on: a seller has no policy on this table.
  -- Every policy that admits a reader must mention the buyer themselves or an
  -- admin, and nothing else.
  select '0037 nobody but the buyer or an operator reads funding evidence',
         not exists (select 1 from pg_policies
                      where tablename = 'buyer_verifications' and cmd = 'SELECT'
                        and (qual is null
                          or (qual not like '%is_platform_admin%'
                              and qual not like '%buyer_id%')))
  union all
  select '0037 no client role can delete a verification',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public' and table_name = 'buyer_verifications'
                        and privilege_type = 'DELETE'
                        and grantee in ('authenticated', 'anon'))
  union all
  select '0037 the badge function is not executable by anon',
         not has_function_privilege('anon', 'public.buyer_verification_badge(uuid)', 'execute')

  union all
  /*
   * 0038. Both views that act as their own access check must be barrier views.
   *
   * Without it the planner pushes a caller's predicate underneath the view's
   * security qual and evaluates it against rows the view is discarding — the
   * rows never appear in the result and leak through the side effects instead.
   * Reproduced against a real database before this check was written.
   */
  select '0038 boundary views are barrier views',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'v'
                        and c.relname in ('listing_status_timeline', 'market_listings')
                        and not coalesce(c.reloptions, '{}') @> array['security_barrier=true'])
  union all
  -- The other half, and the reason the linter's suggested fix is wrong here:
  -- as invoker views these two return nothing. The timeline shows rows the
  -- caller's own policy withholds, and anon holds no grant on `listings` at all.
  select '0038 boundary views are not invoker views',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'v'
                        and c.relname in ('listing_status_timeline', 'market_listings')
                        and coalesce(c.reloptions, '{}') @> array['security_invoker=true'])

  -- Invariants that must survive every migration. These are the ones that
  -- would go unnoticed: nothing breaks, the data is simply readable by
  -- somebody who should not have it.
  union all
  select 'every table has RLS enabled and forced',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'r'
                        and (not c.relrowsecurity or not c.relforcerowsecurity))
  union all
  select 'no table has RLS on and zero policies',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
                        and not exists (select 1 from pg_policies p
                                         where p.schemaname = 'public' and p.tablename = c.relname))
  union all
  select 'every app function pins search_path',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'app'
                        and (p.proconfig is null
                          or not exists (select 1 from unnest(p.proconfig) c
                                          where c like 'search_path=%')))
  union all
  /*
   * Every function an unauthenticated caller can reach, named.
   *
   * This was a count, and the count was two. 0036 added the market search and
   * the view tally — both deliberate, both anon by design — and the check
   * started failing while being right about nothing: "expected 2, found 4"
   * does not say which function appeared, so the only way to act on it was to
   * go and look. Naming the set means a new entry fails loudly and identifies
   * itself, and an intended addition is a one-line edit here that a reviewer
   * can actually weigh.
   */
  select 'anon executes only the four intended functions',
         (select coalesce(array_agg(p.proname::text order by p.proname), '{}'::text[])
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and has_function_privilege('anon', p.oid, 'EXECUTE'))
         = array['market_is_open', 'record_listing_view', 'search_market', 'unsubscribe_by_token']
)

select case when ok then 'PASS' else '*** FAIL ***' end as result, check_name
  from checks
 order by ok, check_name;
