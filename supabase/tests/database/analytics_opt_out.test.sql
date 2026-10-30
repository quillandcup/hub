-- pgTAP tests for 20270303000000_analytics_opt_out.sql ("leave me out of statistics", the switch on /privacy):
--   * a member can set and clear analytics_opt_out_at on their own profile, and only their own
--     (the column grant plus the existing "Users can update own profile" policy).
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'optout-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'optout-bob@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'optout-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a2', 'optout-bob@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, analytics_opt_out_at = NULL;

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Alice turns it on for herself, tries it on Bob, then turns it off again.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "role": "authenticated"}', true);
WITH u AS (UPDATE public.user_profiles SET analytics_opt_out_at = now() WHERE id = '00000000-0000-4000-a000-00000000e1a1' RETURNING id)
INSERT INTO result SELECT 'alice_on', to_jsonb(count(*)) FROM u;
WITH u AS (UPDATE public.user_profiles SET analytics_opt_out_at = now() WHERE id = '00000000-0000-4000-a000-00000000e1a2' RETURNING id)
INSERT INTO result SELECT 'alice_sets_bobs', to_jsonb(count(*)) FROM u;
INSERT INTO result SELECT 'alice_value', to_jsonb(analytics_opt_out_at IS NOT NULL) FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000e1a1';
WITH u AS (UPDATE public.user_profiles SET analytics_opt_out_at = NULL WHERE id = '00000000-0000-4000-a000-00000000e1a1' RETURNING id)
INSERT INTO result SELECT 'alice_off', to_jsonb(count(*)) FROM u;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_on'), '1'::jsonb, 'a member can turn it on for themselves');
SELECT is((SELECT value FROM result WHERE label = 'alice_value'), 'true'::jsonb, 'and it is saved');
SELECT is((SELECT value FROM result WHERE label = 'alice_sets_bobs'), '0'::jsonb, 'but not for someone else');
SELECT is((SELECT value FROM result WHERE label = 'alice_off'), '1'::jsonb, 'and can turn it off again');

SELECT * FROM finish(true);
ROLLBACK;
