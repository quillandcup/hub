-- pgTAP tests for 20270306200000_user_profiles_nav_mode.sql (the member sidebar mode):
--   * a member can save open, closed or auto for themselves, and only themselves
--     (user_profiles has column-level UPDATE grants, so the column needs its own grant);
--   * anything else is refused by the CHECK constraint.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'navmode-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'navmode-bob@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'navmode-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a2', 'navmode-bob@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, nav_mode = NULL;

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Alice saves a mode for herself, tries it on Bob, then tries a mode that doesn't exist.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "role": "authenticated"}', true);
WITH u AS (UPDATE public.user_profiles SET nav_mode = 'auto' WHERE id = '00000000-0000-4000-a000-00000000f1a1' RETURNING id)
INSERT INTO result SELECT 'alice_saves', to_jsonb(count(*)) FROM u;
INSERT INTO result SELECT 'alice_value', to_jsonb(nav_mode) FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000f1a1';
WITH u AS (UPDATE public.user_profiles SET nav_mode = 'closed' WHERE id = '00000000-0000-4000-a000-00000000f1a2' RETURNING id)
INSERT INTO result SELECT 'alice_sets_bobs', to_jsonb(count(*)) FROM u;
SELECT throws_ok(
  $$UPDATE public.user_profiles SET nav_mode = 'hover' WHERE id = '00000000-0000-4000-a000-00000000f1a1'$$,
  '23514', NULL, 'a mode other than open, closed or auto is refused');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_saves'), '1'::jsonb, 'a member can save the mode for themselves');
SELECT is((SELECT value FROM result WHERE label = 'alice_value'), '"auto"'::jsonb, 'and it is saved');
SELECT is((SELECT value FROM result WHERE label = 'alice_sets_bobs'), '0'::jsonb, 'but not for someone else');

SELECT * FROM finish(true);
ROLLBACK;
