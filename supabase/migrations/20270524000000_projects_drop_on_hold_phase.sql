-- "On hold" was merged into "Hibernating" (20270511000000 moved the projects; the app stopped offering
-- it in the same deploy). Production has no project at on_hold, so the check no longer accepts it.

set lock_timeout = '5s';

-- Approved ban-drop-constraint ignore: the last use of on_hold was removed in #1029, which is deployed, and the check is only replaced, in the statement below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.writing_projects DROP CONSTRAINT writing_projects_phase_check;

ALTER TABLE public.writing_projects ADD CONSTRAINT writing_projects_phase_check
  CHECK (phase IN ('planning', 'outlining', 'drafting', 'first_read_through', 'revising', 'developmental_edit', 'beta_readers', 'line_copy_edit', 'final_read_through', 'final_beta_read', 'publishing', 'complete', 'published', 'hibernating'));
