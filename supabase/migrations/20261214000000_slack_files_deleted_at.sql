-- A file removed from a Hub-written chat message is soft-deleted in Bronze (deleted_at) and its
-- bytes leave the private slack-files bucket (storage_path is cleared once they are gone). A row
-- with deleted_at set and storage_path still set is a removal that failed and is retried by
-- sweepDeletedFileBytes (lib/chat/file-cleanup.ts). Service role only, like the rest of the table.

ALTER TABLE bronze.slack_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS slack_files_deleted_pending_idx ON bronze.slack_files (deleted_at)
  WHERE deleted_at IS NOT NULL AND storage_path IS NOT NULL;
