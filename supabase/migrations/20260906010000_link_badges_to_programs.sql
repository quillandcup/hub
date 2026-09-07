-- Links the 180 Program and Self-Editing Academy course badges to their `programs` row and
-- switches them to computed automatic badges -- the same "Gold layer computed on-demand"
-- pattern as founding_hedgie/prickle_milestones in lib/badges.ts, NOT the event_id/
-- event_attendees trigger pattern from 20260905010000_link_badges_to_events_and_attendees.sql.
--
-- Why not the event pattern: "completed a program" isn't a discrete admin action like marking
-- attendance -- it's a date (a cohort's expires_at) passing, which a computed badge picks up for
-- free on every read with no cron/trigger needed to detect the transition. See docs/TODO.md's
-- "Multi-Product Support & Badges" section for the prior open question this resolves.
--
-- Unlike badge_types.event_id, program_id is NOT unique -- a program may eventually grow more
-- than one badge (e.g. a future Self-Editing Academy per-level badge), so multiple badge_types
-- could point at the same program.

ALTER TABLE badge_types ADD COLUMN program_id UUID REFERENCES programs(id) ON DELETE SET NULL;
COMMENT ON COLUMN badge_types.program_id IS
  'Optional link to the program this badge represents completion of. Implies is_automatic: the badge is computed on the fly in lib/badges.ts from member_program_enrollments + program_cohorts (completed = an enrolled cohort''s expires_at has passed), never written to member_badges going forward. Manual awarding is disabled once set.';

-- These two badges predate program/cohort tracking and were seeded as plain manual badges
-- (see 20260831000001_create_badges.sql). Flipping is_automatic to true here does not touch any
-- pre-existing member_badges rows for them -- lib/badges.ts merges those legacy manual awards
-- with computed cohort completions so no history is lost for members awarded before enrollment
-- tracking existed.
UPDATE badge_types SET program_id = (SELECT id FROM programs WHERE slug = '180-program'), is_automatic = true
  WHERE key = 'program_180';
UPDATE badge_types SET program_id = (SELECT id FROM programs WHERE slug = 'self-editing-academy'), is_automatic = true
  WHERE key = 'self_editing_academy';
