-- pgTAP tests for the enrollment match in get_record_history (20261103000000): enrolling a member
-- shows on the program's history through its cohort, and not on another program's. Rolled back.
-- Run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(2);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enroll-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f5a4', 'enroll-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f501', 'Enroll Alice', 'enroll-alice@example.test', now(), 'lead');
INSERT INTO public.programs (id, name, slug) VALUES
  ('00000000-0000-4000-a000-00000000f511', 'Enroll Program A', 'enroll-program-a'),
  ('00000000-0000-4000-a000-00000000f512', 'Enroll Program B', 'enroll-program-b');
INSERT INTO public.program_cohorts (id, program_id, name, starts_at, expires_at) VALUES
  ('00000000-0000-4000-a000-00000000f521', '00000000-0000-4000-a000-00000000f511', 'Cohort 1', current_date, current_date + 90),
  ('00000000-0000-4000-a000-00000000f522', '00000000-0000-4000-a000-00000000f512', 'Cohort 1', current_date, current_date + 90);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "enroll-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.member_program_enrollments (member_id, cohort_id) VALUES
  ('00000000-0000-4000-a000-00000000f501', '00000000-0000-4000-a000-00000000f521');

INSERT INTO result SELECT 'a', COALESCE(jsonb_agg(h.entity_type ORDER BY h.entity_type), '[]'::jsonb)
  FROM public.get_record_history(ARRAY['program', 'program_cohort', 'program_enrollment'], '00000000-0000-4000-a000-00000000f511', 200, 'program_id') h;
INSERT INTO result SELECT 'b', COALESCE(jsonb_agg(h.entity_type ORDER BY h.entity_type), '[]'::jsonb)
  FROM public.get_record_history(ARRAY['program', 'program_cohort', 'program_enrollment'], '00000000-0000-4000-a000-00000000f512', 200, 'program_id') h;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'a'), '["program", "program_cohort", "program_enrollment"]'::jsonb,
  'the program''s history has the program, its cohort and the enrollment');
SELECT is((SELECT value FROM result WHERE label = 'b'), '["program", "program_cohort"]'::jsonb,
  'another program does not get the enrollment');

SELECT * FROM finish(true);
ROLLBACK;
