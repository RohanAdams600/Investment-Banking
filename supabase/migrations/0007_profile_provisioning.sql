-- Automatic profile provisioning.
--
-- A row in `auth.users` without a matching `public.profiles` row is a user who
-- can sign in but has no name, no email on file, and no notification
-- preferences. Every read path would need a null check for a state that should
-- not exist.
--
-- Doing this in the application instead would mean the profile is created by
-- whichever code path happens to run after sign-up, and missed entirely by the
-- ones that do not — OAuth callbacks, invitations, an operator creating a user
-- by hand. A trigger on the table covers all of them.

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    -- Supabase puts sign-up form fields in raw_user_meta_data. Absent for
    -- users created by an operator, hence the null-safe access.
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '')
  )
  -- An operator who pre-creates a profile should not have the trigger fail the
  -- user insert underneath them.
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- No role is granted here, deliberately.
--
-- A new user holds no platform role until they choose one during onboarding.
-- Defaulting them to `buyer` would silently grant listing access to anyone who
-- creates an account, including automated sign-ups, before anyone has looked at
-- them. Deny by default extends to registration.
