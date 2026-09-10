-- Extend member_activities toward being the CRM's central activity log:
-- explicit actor direction (member's own action vs. staff/system acting on
-- their behalf), and a rename of `metadata` -> `data` since it holds the
-- event's actual content (e.g. an email body), not incidental metadata
-- about the row.
ALTER TABLE member_activities
  ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'member' CHECK (actor_kind IN ('member', 'staff', 'system')),
  ADD COLUMN actor_user_id UUID REFERENCES auth.users(id);

ALTER TABLE member_activities RENAME COLUMN metadata TO data;

COMMENT ON COLUMN member_activities.actor_kind IS 'Who performed this action: the member themselves, a staff member acting on/with them (e.g. an outreach touch), or an automated system/pipeline.';
COMMENT ON COLUMN member_activities.actor_user_id IS 'The Hedgie Hub user who performed this action, when actor_kind = ''staff''.';
COMMENT ON COLUMN member_activities.data IS 'Full structured content of the event (e.g. an email''s subject/body, a DM''s text) — the event''s actual data, not secondary metadata.';

-- Speeds up the per-member timeline query (WHERE member_id = ? ORDER BY
-- occurred_at DESC) beyond what the existing separate single-column indexes
-- on member_id and occurred_at provide individually.
CREATE INDEX IF NOT EXISTS idx_member_activities_member_occurred
  ON member_activities (member_id, occurred_at DESC);

-- Unused catalog table: nothing in the app reads or writes it, and
-- member_activities.activity_type has no FK to it.
DROP TABLE IF EXISTS activity_types;
