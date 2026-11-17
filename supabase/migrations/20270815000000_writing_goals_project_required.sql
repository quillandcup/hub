-- A writing goal always belongs to a project. `writing_goals.project_id` was nullable from the start
-- (20260828180000), and the app carried handling for a goal with no project, but nothing creates one: the
-- goal form, the TrackBear import and the demo seed all set it, and production has none (0 of 63 rows,
-- deleted ones included). So it becomes NOT NULL, and the code that guarded against a missing project goes.
--
-- This only tightens the column. Code still running during a deploy always sets `project_id` on insert,
-- so it keeps working. If a row with no project ever existed when this runs, VALIDATE fails and the
-- migration stops, rather than the row being dropped or hidden.
--
-- A CHECK added NOT VALID, validated, and then SET NOT NULL (which Postgres satisfies from the validated
-- check without scanning the table again): the way that never holds a long lock on a big table. The check
-- stays: squawk bans dropping a constraint, and it says the same thing the column now does.

set lock_timeout = '5s';

ALTER TABLE public.writing_goals ADD CONSTRAINT writing_goals_project_id_required CHECK (project_id IS NOT NULL) NOT VALID;
ALTER TABLE public.writing_goals VALIDATE CONSTRAINT writing_goals_project_id_required;
ALTER TABLE public.writing_goals ALTER COLUMN project_id SET NOT NULL;
