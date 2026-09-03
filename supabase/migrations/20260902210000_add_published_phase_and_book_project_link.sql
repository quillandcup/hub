-- "Publish" flow (Projects UI): marking a project published now collects the book's Bookshelf
-- details in the same step, instead of managing member_books separately. Adds the 'published'
-- phase and a nullable link from member_books back to the writing_projects row it came from.

ALTER TABLE writing_projects DROP CONSTRAINT writing_projects_phase_check;
ALTER TABLE writing_projects ADD CONSTRAINT writing_projects_phase_check
  CHECK (phase IN ('planning', 'drafting', 'revising', 'on_hold', 'complete', 'published', 'abandoned'));

-- Nullable: books added before this feature (or added standalone via the "My Books" manager,
-- not tied to a tracked project) stay valid with no project link.
ALTER TABLE member_books ADD COLUMN project_id UUID REFERENCES writing_projects(id) ON DELETE SET NULL;

-- A project publishes to at most one shelf entry -- a double-submit of the publish action
-- surfaces as a Postgres unique violation (23505) rather than a duplicate member_books row.
CREATE UNIQUE INDEX idx_member_books_project_id_unique ON member_books(project_id) WHERE project_id IS NOT NULL;
