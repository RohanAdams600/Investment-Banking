-- Reduce table privileges to an explicit allowlist.
--
-- Supabase configures default privileges on a new project that grant ALL on
-- every table created in `public` to `anon` and `authenticated`. Convenient for
-- a prototype; wrong here.
--
-- The grant model in 0006 treats privileges as the outer gate and policies as
-- the inner one, and deliberately withholds a grant where an operation should
-- be impossible — no DELETE on the audit log, no UPDATE on consent records.
-- Those omissions did nothing, because the default privileges had already
-- granted them. RLS still denied the rows, so nothing leaked; but the outer
-- gate was standing open and one missing policy would have been the only thing
-- between a client and a rewritten audit trail.
--
-- Two things were needed to catch this. The migrations had to run against a
-- real Supabase project rather than a local Postgres, and the local shim had to
-- start reproducing Supabase's defaults so the local suite can prove the fix.
--
-- Ordering note: this runs after every table exists, so a blanket revoke
-- followed by precise grants covers all of them.

-- ---------------------------------------------------------------------------
-- Start from nothing
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

-- Future tables too. Without this, the next migration to add a table
-- reintroduces the same problem silently, and whoever writes it will have no
-- reason to suspect anything.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grant back exactly what each role needs
-- ---------------------------------------------------------------------------
--
-- Every line below is a deliberate decision. What is absent is as meaningful as
-- what is present:
--
--   firms            no INSERT — creation goes through create_firm()
--                    no DELETE — retention obligations outlive the account
--   firm_members     full CRUD, all of it gated on firm administration
--   profiles         no DELETE — account deletion anonymises, it does not erase
--   user_roles       no UPDATE — a role is granted or revoked, never edited
--   consent_records  no UPDATE, no DELETE — append-only is the whole point
--   audit_log        SELECT only — entries are written with the service role

grant select, update on public.firms to authenticated;
grant select, insert, update, delete on public.firm_members to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.user_roles to authenticated;
grant select, insert, update, delete on public.jurisdictions to authenticated;
grant select, insert, update, delete on public.legal_templates to authenticated;
grant select, insert on public.consent_records to authenticated;
grant select on public.audit_log to authenticated;

-- Anonymous visitors read reference data only: the sign-up form needs the list
-- of active jurisdictions, and the terms of use has to be reachable before
-- anyone has an account.
grant select on public.jurisdictions to anon;
grant select on public.legal_templates to anon;

-- `service_role` keeps its privileges untouched. It bypasses RLS by design and
-- is the only writer of the audit log.
