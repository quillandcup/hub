-- pgTAP tests for member_owned_row_counts (20270612000000): the per-table counts the merge dialog shows. Admins and the
-- service role may call it, members may not, and it counts what a member owns, leaving out zero counts and the derived
-- stats. Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000c0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owned-ada@example.test'),
  ('00000000-0000-4000-a000-00000000c0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owned-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000c0a1', 'owned-ada@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c0a2', 'owned-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_OwnedAda0001', 'Ada Example', 'owned-member-ada@example.test', '2026-01-01', 'active'),
  ('mbr_OwnedFern001', 'Fern Example', 'owned-member-fern@example.test', '2026-01-01', 'active');
INSERT INTO public.member_name_aliases (member_id, alias) VALUES
  ('mbr_OwnedAda0001', 'pgtap owned alias one'),
  ('mbr_OwnedAda0001', 'pgtap owned alias two');
INSERT INTO public.member_metrics (member_id) VALUES ('mbr_OwnedAda0001');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000c0a1", "email": "owned-ada@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_refused', to_jsonb(pg_temp.failure($$SELECT * FROM public.member_owned_row_counts('mbr_OwnedAda0001')$$) LIKE 'Only admins%');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000c0a2", "email": "owned-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alias_count', to_jsonb(row_count) FROM public.member_owned_row_counts('mbr_OwnedAda0001') WHERE table_name = 'member_name_aliases' AND column_name = 'member_id';
INSERT INTO result SELECT 'derived_left_out', to_jsonb(count(*)) FROM public.member_owned_row_counts('mbr_OwnedAda0001') WHERE table_name IN ('member_metrics', 'member_engagement', 'member_directory');
INSERT INTO result SELECT 'zero_left_out', to_jsonb(count(*)) FROM public.member_owned_row_counts('mbr_OwnedAda0001') WHERE row_count = 0;
INSERT INTO result SELECT 'none_for_empty_member', to_jsonb(count(*)) FROM public.member_owned_row_counts('mbr_OwnedFern001') WHERE table_name = 'member_name_aliases';

SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
INSERT INTO result SELECT 'service_role_ok', to_jsonb(count(*)) FROM public.member_owned_row_counts('mbr_OwnedAda0001') WHERE table_name = 'member_name_aliases';

RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_refused'), 'true'::jsonb, 'a member cannot count another member''s data');
SELECT is((SELECT value FROM result WHERE label = 'alias_count'), '2'::jsonb, 'an admin gets the rows per table');
SELECT is((SELECT value FROM result WHERE label = 'derived_left_out'), '0'::jsonb, 'derived stats and the directory are left out');
SELECT is((SELECT value FROM result WHERE label = 'zero_left_out'), '0'::jsonb, 'tables with no rows are left out');
SELECT is((SELECT value FROM result WHERE label = 'none_for_empty_member'), '0'::jsonb, 'a member with no aliases has none counted');
SELECT is((SELECT value FROM result WHERE label = 'service_role_ok'), '1'::jsonb, 'the service role may call it too');

SELECT * FROM finish(true);
ROLLBACK;
