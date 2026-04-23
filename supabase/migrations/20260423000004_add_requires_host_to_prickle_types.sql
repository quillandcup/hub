-- Add requires_host field to prickle_types to mark which types should have hosts
-- This helps distinguish between data quality issues (missing hosts) and intentional design (open tables)

ALTER TABLE prickle_types ADD COLUMN IF NOT EXISTS requires_host BOOLEAN DEFAULT true;

-- Mark known unhosted prickle types
UPDATE prickle_types SET requires_host = false WHERE normalized_name IN (
  'open-table',           -- Open discussion time, no host
  'social-media-sunday',  -- Community event, no host
  'craft-chat',           -- Community event, no host
  'pomodoro',             -- Self-directed work time, no host
  'authorlife-heads-down',-- Scheduled community time, no host
  'monthly-goal-review',  -- Community review session, no host
  'pop-up'                -- Impromptu/unscheduled, often no host
);

-- Progress Prickles and other types typically DO have hosts (default true)
