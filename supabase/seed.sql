-- Reference data.
--
-- Applied to every environment including production. This is configuration, not
-- sample data: no fake users, no fake firms, no fake listings.
--
-- Idempotent throughout, so re-running it after a migration is safe.

-- ---------------------------------------------------------------------------
-- Jurisdictions
-- ---------------------------------------------------------------------------
--
-- All fifty states plus DC are present so a state can be switched on without a
-- migration. `is_active` is false for every one of them — activating a state is
-- a deliberate act that follows a check on the platform's regulatory posture
-- there, not something that happens by default because a row exists.
--
-- See docs/decisions/open-questions.md #3: whether the platform acts as a
-- broker, a listing service, or neither in a given state is a question for
-- counsel, and it determines what disclosures have to be attached before that
-- state is turned on.

insert into public.jurisdictions (code, name, country_code, is_active) values
  ('US-AL', 'Alabama', 'US', false),
  ('US-AK', 'Alaska', 'US', false),
  ('US-AZ', 'Arizona', 'US', false),
  ('US-AR', 'Arkansas', 'US', false),
  ('US-CA', 'California', 'US', false),
  ('US-CO', 'Colorado', 'US', false),
  ('US-CT', 'Connecticut', 'US', false),
  ('US-DE', 'Delaware', 'US', false),
  ('US-DC', 'District of Columbia', 'US', false),
  ('US-FL', 'Florida', 'US', false),
  ('US-GA', 'Georgia', 'US', false),
  ('US-HI', 'Hawaii', 'US', false),
  ('US-ID', 'Idaho', 'US', false),
  ('US-IL', 'Illinois', 'US', false),
  ('US-IN', 'Indiana', 'US', false),
  ('US-IA', 'Iowa', 'US', false),
  ('US-KS', 'Kansas', 'US', false),
  ('US-KY', 'Kentucky', 'US', false),
  ('US-LA', 'Louisiana', 'US', false),
  ('US-ME', 'Maine', 'US', false),
  ('US-MD', 'Maryland', 'US', false),
  ('US-MA', 'Massachusetts', 'US', false),
  ('US-MI', 'Michigan', 'US', false),
  ('US-MN', 'Minnesota', 'US', false),
  ('US-MS', 'Mississippi', 'US', false),
  ('US-MO', 'Missouri', 'US', false),
  ('US-MT', 'Montana', 'US', false),
  ('US-NE', 'Nebraska', 'US', false),
  ('US-NV', 'Nevada', 'US', false),
  ('US-NH', 'New Hampshire', 'US', false),
  ('US-NJ', 'New Jersey', 'US', false),
  ('US-NM', 'New Mexico', 'US', false),
  ('US-NY', 'New York', 'US', false),
  ('US-NC', 'North Carolina', 'US', false),
  ('US-ND', 'North Dakota', 'US', false),
  ('US-OH', 'Ohio', 'US', false),
  ('US-OK', 'Oklahoma', 'US', false),
  ('US-OR', 'Oregon', 'US', false),
  ('US-PA', 'Pennsylvania', 'US', false),
  ('US-RI', 'Rhode Island', 'US', false),
  ('US-SC', 'South Carolina', 'US', false),
  ('US-SD', 'South Dakota', 'US', false),
  ('US-TN', 'Tennessee', 'US', false),
  ('US-TX', 'Texas', 'US', false),
  ('US-UT', 'Utah', 'US', false),
  ('US-VT', 'Vermont', 'US', false),
  ('US-VA', 'Virginia', 'US', false),
  ('US-WA', 'Washington', 'US', false),
  ('US-WV', 'West Virginia', 'US', false),
  ('US-WI', 'Wisconsin', 'US', false),
  ('US-WY', 'Wyoming', 'US', false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Legal templates
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT seeded.
--
-- The terms of use, privacy policy, NDA, and broker agreement have to be
-- written and reviewed by counsel before they exist in the database. Seeding
-- placeholder text would create consent records pointing at a document nobody
-- approved, and those records are retained as evidence — the harm is not
-- cosmetic and cannot be cleaned up afterwards.
--
-- Templates are inserted through the admin panel (step 10) once real text
-- exists. Until then `legal_templates` is empty, and the sign-up flow has
-- nothing to present, which is the correct behaviour.
