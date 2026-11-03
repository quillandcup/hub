-- Three more project statuses for the stages of Spark to Shelf: "developmental_edit", "beta_readers"
-- and "line_copy_edit". The check only widens, so the code still running during a deploy keeps working.
-- Also adds the writing_journey feature flag (the Journey tab in My Writing), off for everyone until
-- an admin turns it on for a user, a segment or everyone.

set lock_timeout = '5s';

-- Approved ban-drop-constraint ignore: the check is only replaced, in the statements below.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.writing_projects DROP CONSTRAINT writing_projects_phase_check;

ALTER TABLE public.writing_projects ADD CONSTRAINT writing_projects_phase_check
  CHECK (phase IN ('planning', 'outlining', 'drafting', 'revising', 'developmental_edit', 'beta_readers', 'line_copy_edit', 'on_hold', 'complete', 'published', 'hibernating'));

INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('writing_journey', false)
ON CONFLICT (feature_key) DO NOTHING;
