-- Identity: profiles and platform roles.

-- Application-owned user data. `auth.users` is managed by Supabase Auth and is
-- not ours to extend, so profile fields live here keyed 1:1 by the auth id.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email citext not null,
  phone text,
  avatar_url text,

  verification_status app.verification_status not null default 'unverified',
  verified_at timestamptz,

  -- Granular communication preferences, respected everywhere a notification is
  -- sent. Defaults are opt-*out* for transactional mail and opt-*in* for
  -- marketing, which is the correct default in both directions.
  notify_email boolean not null default true,
  notify_sms boolean not null default false,
  marketing_opt_in boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_key on public.profiles (email);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------

-- Platform roles as a join table, never a column on the user.
--
-- This is the single most consequential shape decision in the schema. A broker
-- who also buys businesses is one account holding two roles. Modelled as an
-- enum column it would be two accounts, two logins, and two disconnected
-- histories on the same person.
create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role app.platform_role not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,

  primary key (user_id, role)
);

create index user_roles_role_idx on public.user_roles (role);
