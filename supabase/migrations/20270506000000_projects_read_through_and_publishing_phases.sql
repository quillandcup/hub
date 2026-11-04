-- Three more project statuses for the Journey map: "first_read_through" (before the first revision),
-- "final_read_through" (after the line & copy edit, before the final beta read) and "publishing" (the
-- Publishing stage). The check only widens, so the code still running during a deploy keeps working.

set lock_timeout = '5s';

-- Approved ban-drop-constraint ignore: the check is only replaced, in the statement below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.writing_projects DROP CONSTRAINT writing_projects_phase_check;

ALTER TABLE public.writing_projects ADD CONSTRAINT writing_projects_phase_check
  CHECK (phase IN ('planning', 'outlining', 'drafting', 'first_read_through', 'revising', 'developmental_edit', 'beta_readers', 'line_copy_edit', 'final_read_through', 'final_beta_read', 'publishing', 'on_hold', 'complete', 'published', 'hibernating'));
