-- Audit log.
--
-- Append-only, platform-wide. Introduced in step 2 rather than with the admin
-- panel because the tables that most need auditing — role grants, firm
-- membership, verification decisions — exist from step 2, and an audit log that
-- starts recording halfway through a system's life has a hole in it exactly
-- where the early configuration happened.

create table public.audit_log (
  id bigint generated always as identity primary key,

  -- Null for system and scheduled actions. ON DELETE SET NULL rather than
  -- cascade: deleting a user must not erase the record of what they did.
  actor_user_id uuid references auth.users (id) on delete set null,

  -- Denormalised so the entry stays meaningful after the actor is deleted or
  -- anonymised. An audit row that reads "someone did this" is not an audit row.
  actor_email citext,

  action text not null check (length(trim(action)) > 0),

  -- What was acted on. Free-form rather than a foreign key, because this table
  -- outlives the rows it describes and a constraint would force cascade
  -- deletion of history.
  entity_type text not null,
  entity_id text,

  firm_id uuid references public.firms (id) on delete set null,

  -- Before/after or arbitrary context. Never contains document contents or
  -- credentials — see the note below.
  metadata jsonb not null default '{}'::jsonb,

  ip_address inet,
  user_agent text,

  created_at timestamptz not null default now()
);

create index audit_log_actor_idx on public.audit_log (actor_user_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_firm_idx on public.audit_log (firm_id, created_at desc);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- What must never go in `metadata`: document contents, financial statement
-- bodies, credentials, session tokens, or full payloads. This table is broadly
-- readable by admins and is exported; it records *that* something happened and
-- to what, not the confidential substance of it.
