-- pgTAP tests for get_record_history (20261029000000): one record's audit rows, newest first,
-- scoped to that entity, and admin-only. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'history-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f2a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'history-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', 'history-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f2a4', 'history-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('00000000-0000-4000-a000-00000000f201', 'History Alice', 'history-alice@example.test', now(), 'lead', '00000000-0000-4000-a000-00000000f2a1'),
  ('00000000-0000-4000-a000-00000000f202', 'History Bob', 'history-bob@example.test', now(), 'lead', NULL);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f2a4", "email": "history-dana@example.test", "role": "authenticated"}', true);
UPDATE public.members SET status = 'active' WHERE id = '00000000-0000-4000-a000-00000000f201';
UPDATE public.members SET status = 'active' WHERE id = '00000000-0000-4000-a000-00000000f202';
INSERT INTO result SELECT 'dana', COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
  FROM public.get_record_history(ARRAY['member'], '00000000-0000-4000-a000-00000000f201') h;

INSERT INTO result SELECT 'dana_type', to_jsonb(count(*))
  FROM public.get_record_history(ARRAY['member']) h WHERE h.entity_id IN
    ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f202');
INSERT INTO result SELECT 'dana_other_type', to_jsonb(count(*))
  FROM public.get_record_history(ARRAY['segment']) h WHERE h.entity_id IN
    ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f202');

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f2a1", "email": "history-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice', to_jsonb(count(*))
  FROM public.get_record_history(ARRAY['member'], '00000000-0000-4000-a000-00000000f201');
RESET ROLE;

SELECT is(
  (SELECT jsonb_array_length(value) FROM result WHERE label = 'dana'),
  2,
  'an admin gets the record''s insert and its update'
);
SELECT is(
  (SELECT value -> 0 ->> 'event_type' FROM result WHERE label = 'dana'),
  'update',
  'newest first'
);
SELECT is(
  (SELECT count(*)::int FROM result, jsonb_array_elements(value) e
    WHERE label = 'dana' AND e ->> 'entity_id' <> '00000000-0000-4000-a000-00000000f201'),
  0,
  'only that record''s rows, not another member''s'
);
SELECT is((SELECT value FROM result WHERE label = 'dana_type'), '4'::jsonb, 'without an id, every record of the type (two inserts, two updates)');
SELECT is((SELECT value FROM result WHERE label = 'dana_other_type'), '0'::jsonb, 'a different entity type matches none of them');
SELECT is((SELECT value FROM result WHERE label = 'alice'), '0'::jsonb, 'a non-admin gets nothing');

SELECT * FROM finish(true);
ROLLBACK;
