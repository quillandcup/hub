-- Finisher and Author: two automatic, leveled badges, built like Published Author (docs/product/FINISHERS.md, docs/product/WRITER_TITLES.md).
--
-- Finisher counts a member's confirmed THE END milestones, Author their confirmed publish-ready ones, one per work, counted while
-- a member and only as far as the viewer may see them (lib/badges.ts, milestoneBadgeCounts). Nothing is stored per member: like
-- the other automatic badges the level is computed when a profile is read, so there is no award row and no notification.
-- Levels follow Published Author: 1, 3, 5 and 10.

INSERT INTO badge_types (key, name, description, icon, category, has_levels, is_automatic) VALUES
  ('finisher', 'Finisher', 'Wrote THE END on a book while a member of the community -- computed from your milestones.', '✍️', 'community', true, true),
  ('author', 'Author', 'Got a book publish-ready while a member of the community -- computed from your milestones.', '📖', 'community', true, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO badge_levels (badge_type_id, level, name, threshold)
SELECT id, 1, 'Finisher', 1 FROM badge_types WHERE key = 'finisher'
UNION ALL
SELECT id, 2, '3x Finisher', 3 FROM badge_types WHERE key = 'finisher'
UNION ALL
SELECT id, 3, '5x Finisher', 5 FROM badge_types WHERE key = 'finisher'
UNION ALL
SELECT id, 4, '10x Finisher', 10 FROM badge_types WHERE key = 'finisher'
UNION ALL
SELECT id, 1, 'Author', 1 FROM badge_types WHERE key = 'author'
UNION ALL
SELECT id, 2, '3x Author', 3 FROM badge_types WHERE key = 'author'
UNION ALL
SELECT id, 3, '5x Author', 5 FROM badge_types WHERE key = 'author'
UNION ALL
SELECT id, 4, '10x Author', 10 FROM badge_types WHERE key = 'author'
ON CONFLICT (badge_type_id, level) DO NOTHING;
