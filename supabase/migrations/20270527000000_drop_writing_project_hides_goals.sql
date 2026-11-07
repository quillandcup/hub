-- Second step of taking out the trigger that cleared a project's goals' "show on profile" flag when the
-- project was hidden (expand, then contract; see CLAUDE.md, "Migrations: expand, then contract").
-- 20270523000000 dropped the trigger; this drops the function it called. Nothing else references it.

set lock_timeout = '5s';

-- Approved ban-drop-function ignore: the trigger that called it was dropped in #1116, which is deployed.
-- squawk-ignore ban-drop-function
DROP FUNCTION IF EXISTS public.writing_project_hides_goals();
