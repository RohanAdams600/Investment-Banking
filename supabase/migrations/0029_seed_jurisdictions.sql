-- The jurisdiction seed the repository was missing.
--
-- ---------------------------------------------------------------------------
-- Why this is arriving at 0029 rather than at 0004
-- ---------------------------------------------------------------------------
--
-- It was already on the live project, applied as `seed_jurisdictions` between
-- 0007 and 0008 — and it existed nowhere in this repository. The live database
-- had 51 rows; a replay from `supabase/migrations/` produced zero. Nobody
-- noticed because every test that needs a jurisdiction inserts its own, and the
-- live project has had them since the first week.
--
-- What that meant is worse than a missing seed: **the repository could not
-- reproduce the database.** A new environment, a staging copy, or a restore
-- would have come up with an empty `jurisdictions` table — and since the listing
-- form offers only the rows in it, the new deployment would have been inert with
-- no error anywhere to explain why.
--
-- The migrations are the schema's source of truth or they are decoration. This
-- makes them the former again.
--
-- ---------------------------------------------------------------------------
-- All closed, deliberately
-- ---------------------------------------------------------------------------
--
-- `is_active` is false for all 51, and that is the point rather than an
-- oversight. Opening a jurisdiction is the operator stating that they have done
-- their own licensing work in that state. Nothing in this platform verifies a
-- licence, and a seed that shipped states pre-opened would be making that
-- statement on somebody's behalf — which is exactly the claim this product must
-- never make for them.
--
-- `on conflict do nothing` because the live project already has these rows and
-- this migration has to be a no-op there.

insert into public.jurisdictions (code, name, country_code, is_active)
select code, name, 'US', false
  from (values
  ('US-AK', 'Alaska'), ('US-AL', 'Alabama'), ('US-AR', 'Arkansas'), ('US-AZ', 'Arizona'),
  ('US-CA', 'California'), ('US-CO', 'Colorado'), ('US-CT', 'Connecticut'),
  ('US-DC', 'District of Columbia'), ('US-DE', 'Delaware'), ('US-FL', 'Florida'),
  ('US-GA', 'Georgia'), ('US-HI', 'Hawaii'), ('US-IA', 'Iowa'), ('US-ID', 'Idaho'),
  ('US-IL', 'Illinois'), ('US-IN', 'Indiana'), ('US-KS', 'Kansas'), ('US-KY', 'Kentucky'),
  ('US-LA', 'Louisiana'), ('US-MA', 'Massachusetts'), ('US-MD', 'Maryland'), ('US-ME', 'Maine'),
  ('US-MI', 'Michigan'), ('US-MN', 'Minnesota'), ('US-MO', 'Missouri'), ('US-MS', 'Mississippi'),
  ('US-MT', 'Montana'), ('US-NC', 'North Carolina'), ('US-ND', 'North Dakota'),
  ('US-NE', 'Nebraska'), ('US-NH', 'New Hampshire'), ('US-NJ', 'New Jersey'),
  ('US-NM', 'New Mexico'), ('US-NV', 'Nevada'), ('US-NY', 'New York'), ('US-OH', 'Ohio'),
  ('US-OK', 'Oklahoma'), ('US-OR', 'Oregon'), ('US-PA', 'Pennsylvania'), ('US-RI', 'Rhode Island'),
  ('US-SC', 'South Carolina'), ('US-SD', 'South Dakota'), ('US-TN', 'Tennessee'),
  ('US-TX', 'Texas'), ('US-UT', 'Utah'), ('US-VA', 'Virginia'), ('US-VT', 'Vermont'),
  ('US-WA', 'Washington'), ('US-WI', 'Wisconsin'), ('US-WV', 'West Virginia'), ('US-WY', 'Wyoming')
) as seed (code, name)
on conflict (code) do nothing;
