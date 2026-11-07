-- The admin SELECT policy on analytics_events must evaluate is_admin() once per statement (as a sub-select),
-- not once per row: per row, the Feature Usage reports hit the statement timeout (20270522000000).
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(1);

SELECT matches(
  (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
   WHERE polrelid = 'public.analytics_events'::regclass AND polname = 'Admins can view all analytics events'),
  '\(\s*SELECT\s+(public\.)?is_admin\(\)',
  'the admin policy wraps is_admin() in a sub-select'
);

SELECT * FROM finish(true);
ROLLBACK;
