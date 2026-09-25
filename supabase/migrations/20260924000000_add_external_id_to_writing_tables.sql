-- Provenance for rows imported from another writing tracker (first user: the TrackBear importer,
-- lib/trackbear-import.ts). Value is "<source>:<source's own stable id>", e.g.
-- "trackbear:6f1c...". NULL for everything created natively in Hub.
--
-- The unique index is what makes an import idempotent: re-uploading the same (or a newer)
-- export skips rows already brought over instead of duplicating them, and new progress logged
-- in the old tool since the last import attaches to the already-imported project. Deliberately
-- NOT a partial index (PostgREST upsert can't target one); NULLs are distinct in a Postgres
-- unique index, so native rows never collide.

ALTER TABLE writing_projects ADD COLUMN external_id TEXT;
ALTER TABLE writing_progress_entries ADD COLUMN external_id TEXT;
ALTER TABLE writing_goals ADD COLUMN external_id TEXT;

CREATE UNIQUE INDEX idx_writing_projects_member_external_id
  ON writing_projects(member_id, external_id);
CREATE UNIQUE INDEX idx_writing_progress_entries_member_external_id
  ON writing_progress_entries(member_id, external_id);
CREATE UNIQUE INDEX idx_writing_goals_member_external_id
  ON writing_goals(member_id, external_id);

COMMENT ON COLUMN writing_projects.external_id IS
  'Set only on rows imported from another tracker ("trackbear:<uuid>"); unique per member so re-imports are idempotent.';
COMMENT ON COLUMN writing_progress_entries.external_id IS
  'Set only on rows imported from another tracker ("trackbear:<uuid>"); unique per member so re-imports are idempotent.';
COMMENT ON COLUMN writing_goals.external_id IS
  'Set only on rows imported from another tracker ("trackbear:<uuid>"); unique per member so re-imports are idempotent.';
