-- pgTAP tests for 20270920000000_badge_types_counted.sql: Finisher, Author and Published Author show the real count, so they are the
-- only badge types with `counted`; a new type is not counted; the old levels stay for the contract step.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

SELECT results_eq(
  $$SELECT key FROM public.badge_types WHERE counted ORDER BY key$$,
  $$VALUES ('author'::text), ('finisher'::text), ('published_author'::text)$$,
  'only Finisher, Author and Published Author are counted');
SELECT is((SELECT count(*)::int FROM public.badge_types WHERE key IN ('hostess', 'hedgie_mentor', 'founding_hedgie', 'prickle_milestones') AND counted), 0, 'the hosted-quarter, Big Sister, Founding Hedgie and prickle badges are not');
SELECT is((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'badge_types' AND column_name = 'counted'), 'false', 'a new badge type is not counted');
SELECT is((SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'badge_types' AND column_name = 'counted'), 'NO', 'and the flag is never null');
SELECT ok((SELECT count(*) FROM public.badge_levels l JOIN public.badge_types t ON t.id = l.badge_type_id WHERE t.counted) > 0, 'the old level rows are still there until the contract step');

SELECT * FROM finish(true);
ROLLBACK;
