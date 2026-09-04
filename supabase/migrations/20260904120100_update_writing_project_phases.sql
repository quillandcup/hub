-- Adds an 'outlining' phase between 'planning' and 'drafting', matching a reference tool's phase
-- list. 'complete' is intentionally left as-is (not renamed).

ALTER TABLE writing_projects DROP CONSTRAINT writing_projects_phase_check;
ALTER TABLE writing_projects ADD CONSTRAINT writing_projects_phase_check
  CHECK (phase IN ('planning', 'outlining', 'drafting', 'revising', 'on_hold', 'complete', 'published', 'abandoned'));
