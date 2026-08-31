-- Member profile badges (e.g. "Founding Hedgie", "3x Published Author", "Hostess").
-- LOCAL layer: badge_types/badge_levels are admin-curated definitions, and member_badges
-- is an append-only event log of awards (normal CRUD, same pattern as writing_projects /
-- member_status_overrides -- see CLAUDE.md). Not reprocessed from Bronze.
--
-- Leveled badges (has_levels=true) don't store a level on each row. Instead each row is one
-- "occurrence" (e.g. one quarter hosted, one mentee cycle), and the member's current level is
-- derived at read time as the highest badge_levels.threshold met by COUNT(*) of their rows for
-- that badge_type -- see lib/badges.ts deriveLevel(). This lets an admin log occurrences over
-- time (or a script log automatic ones) without ever having to "promote" a row.
--
-- is_automatic badge types (prickle milestones, Founding Hedgie) are never written to
-- member_badges at all -- they're computed on the fly from members/member_metrics in
-- lib/badges.ts, the same "Gold layer computed on-demand" pattern as dashboard queries.
-- The admin UI hides the manual award action for them.

CREATE TABLE badge_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL DEFAULT '🏅',
  category TEXT NOT NULL DEFAULT 'community'
    CHECK (category IN ('milestone', 'community', 'course', 'retreat', 'special')),
  has_levels BOOLEAN NOT NULL DEFAULT false,
  is_automatic BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE badge_types IS
  'LOCAL: admin-curated badge definitions. Not reprocessed.';
COMMENT ON COLUMN badge_types.is_automatic IS
  'true = level/occurrence is computed on the fly (lib/badges.ts), never written to member_badges. Admin UI hides manual award for these.';

CREATE TABLE badge_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_type_id UUID NOT NULL REFERENCES badge_types(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level > 0),
  name TEXT NOT NULL,
  -- Minimum occurrence count (or, for automatic badges, the metric value) required to reach
  -- this level. NULL only makes sense for a has_levels=false badge type's implicit single level.
  threshold INTEGER,
  UNIQUE (badge_type_id, level)
);

COMMENT ON TABLE badge_levels IS
  'LOCAL: ordered levels (e.g. Bronze/Silver/Gold, or "10 Prickles") for a badge_type. Not reprocessed.';

CREATE TABLE member_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  badge_type_id UUID NOT NULL REFERENCES badge_types(id) ON DELETE CASCADE,
  occurred_at DATE NOT NULL DEFAULT current_date,
  awarded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_member_badges_member_id ON member_badges(member_id);
CREATE INDEX idx_member_badges_badge_type_id ON member_badges(badge_type_id);

COMMENT ON TABLE member_badges IS
  'LOCAL: one row per badge occurrence awarded to a member (e.g. one hosted quarter, one retreat). Not reprocessed. Never written for is_automatic badge types.';

ALTER TABLE badge_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_badges ENABLE ROW LEVEL SECURITY;

-- Badge definitions and awards are visible on any member's public profile
-- (Tier 3: visible to all, per app/(member)/members/[id]/page.tsx), so every
-- authenticated user can read them. Only admins can define/award/revoke.
CREATE POLICY "Authenticated users can view badge_types"
  ON badge_types FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins manage badge_types"
  ON badge_types FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Authenticated users can view badge_levels"
  ON badge_levels FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins manage badge_levels"
  ON badge_levels FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Authenticated users can view member_badges"
  ON member_badges FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins manage member_badges"
  ON member_badges FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Seed the badge types called out in the initial spec. Admins can add more
-- (additional retreats, additional courses) from /admin/badges going forward.
INSERT INTO badge_types (key, name, description, icon, category, has_levels, is_automatic) VALUES
  ('prickle_milestones', 'Prickle Milestones', 'Attended a milestone number of prickles.', '🌵', 'milestone', true, true),
  ('founding_hedgie', 'Founding Hedgie', 'Joined during our founding era (2021 - early 2022).', '🦔', 'special', false, true),
  ('published_author', 'Published Author', 'Published a book while a member of the community.', '📚', 'community', true, false),
  ('hostess', 'Hostess', 'Hosted a prickle for a quarter.', '🎙️', 'community', true, false),
  ('hedgie_mentor', 'Hedgie Mentor', 'Mentored a new member through their first month.', '🧭', 'community', true, false),
  ('self_editing_academy', 'Self-Editing Academy', 'Completed the Self-Editing Academy course.', '🎓', 'course', false, false),
  ('program_180', '180 Program', 'Completed the 180 Program course.', '🎓', 'course', false, false),
  ('fall_2025_virtual_retreat', 'Fall 2025 Virtual Retreat', 'Attended the Fall 2025 Virtual Retreat.', '🏕️', 'retreat', false, false),
  ('spring_2025_portugal_retreat', 'Spring 2025 Portugal Retreat', 'Attended the Spring 2025 Portugal Retreat.', '🏖️', 'retreat', false, false);

INSERT INTO badge_levels (badge_type_id, level, name, threshold)
SELECT id, 1, 'First Prickle', 1 FROM badge_types WHERE key = 'prickle_milestones'
UNION ALL
SELECT id, 2, '10 Prickles', 10 FROM badge_types WHERE key = 'prickle_milestones'
UNION ALL
SELECT id, 3, '50 Prickles', 50 FROM badge_types WHERE key = 'prickle_milestones'
UNION ALL
SELECT id, 4, '100 Prickles', 100 FROM badge_types WHERE key = 'prickle_milestones'
UNION ALL
SELECT id, 5, '500 Prickles', 500 FROM badge_types WHERE key = 'prickle_milestones'
UNION ALL
SELECT id, 1, 'Published Author', 1 FROM badge_types WHERE key = 'published_author'
UNION ALL
SELECT id, 2, '3x Published Author', 3 FROM badge_types WHERE key = 'published_author'
UNION ALL
SELECT id, 3, '5x Published Author', 5 FROM badge_types WHERE key = 'published_author'
UNION ALL
SELECT id, 4, '10x Published Author', 10 FROM badge_types WHERE key = 'published_author'
UNION ALL
SELECT id, 1, 'Hostess', 1 FROM badge_types WHERE key = 'hostess'
UNION ALL
SELECT id, 2, '5x Hostess', 5 FROM badge_types WHERE key = 'hostess'
UNION ALL
SELECT id, 3, '10x Hostess', 10 FROM badge_types WHERE key = 'hostess'
UNION ALL
SELECT id, 4, '25x Hostess', 25 FROM badge_types WHERE key = 'hostess'
UNION ALL
SELECT id, 1, 'Hedgie Mentor', 1 FROM badge_types WHERE key = 'hedgie_mentor'
UNION ALL
SELECT id, 2, '2x Hedgie Mentor', 2 FROM badge_types WHERE key = 'hedgie_mentor'
UNION ALL
SELECT id, 3, '5x Hedgie Mentor', 5 FROM badge_types WHERE key = 'hedgie_mentor';
