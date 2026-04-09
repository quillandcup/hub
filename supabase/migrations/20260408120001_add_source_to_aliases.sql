-- Extend member_name_aliases to support Slack user IDs

ALTER TABLE member_name_aliases
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'zoom';

ALTER TABLE member_name_aliases
  DROP CONSTRAINT IF EXISTS member_name_aliases_source_check;

ALTER TABLE member_name_aliases
  ADD CONSTRAINT member_name_aliases_source_check
  CHECK (source IN ('zoom', 'slack'));

CREATE INDEX IF NOT EXISTS idx_member_name_aliases_source ON member_name_aliases(source);

COMMENT ON COLUMN member_name_aliases.source IS 'Source of alias: zoom (display name) or slack (user ID)';
