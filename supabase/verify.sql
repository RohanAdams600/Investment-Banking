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
  -- Two by design: the unsubscribe link and the is-the-market-open boolean.
  -- Anything else is a function an unauthenticated caller can reach.
  select 'anon executes only the two intended functions',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and has_function_privilege('anon', p.oid, 'EXECUTE')) = 2
)

select case when ok then 'PASS' else '*** FAIL ***' end as result, check_name
  from checks
 order by ok, check_name;
