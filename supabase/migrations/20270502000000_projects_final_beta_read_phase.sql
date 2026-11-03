-- One more project status for the Journey map: "final_beta_read", the second round of beta readers
-- after the line & copy edit. The check only widens, so the code still running during a deploy keeps
-- working.

set lock_timeout = '5s';

-- Approved ban-drop-constraint ignore: the check is only replaced, in the statement below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.writing_projects DROP CONSTRAINT writing_projects_phase_check;

ALTER TABLE public.writing_projects ADD CONSTRAINT writing_projects_phase_check
  CHECK (phase IN ('planning', 'outlining', 'drafting', 'revising', 'developmental_edit', 'beta_readers', 'line_copy_edit', 'final_beta_read', 'on_hold', 'complete', 'published', 'hibernating'));
