-- Adds one badge_type per in-person (and virtual) retreat that's happened so far.
-- Same pattern as the two retreat badges seeded in 20260831000001_create_badges.sql:
-- manual (is_automatic=false), single-level (has_levels=false) awards. Attendees are
-- awarded via member_badges rows in a follow-up data script, not here.
--
-- Also renames the two existing retreat badges to match the "<Year> <Place> Retreat"
-- naming convention used for all retreats going forward.

UPDATE badge_types SET name = '2025 Virtual Retreat' WHERE key = 'fall_2025_virtual_retreat';
UPDATE badge_types SET name = '2025 Portugal Retreat' WHERE key = 'spring_2025_portugal_retreat';

INSERT INTO badge_types (key, name, description, icon, category, has_levels, is_automatic) VALUES
  ('arkansas_lakehouse_2022_retreat', '2022 Arkansas Lakehouse Retreat', 'Attended the 2022 Arkansas Lakehouse Retreat.', '🏕️', 'retreat', false, false),
  ('colorado_cabin_2022_retreat', '2022 Colorado Cabin Retreat', 'Attended the 2022 Colorado Cabin Retreat.', '🏔️', 'retreat', false, false),
  ('chicago_2023_retreat', '2023 Chicago Retreat', 'Attended the 2023 Chicago Retreat.', '🏙️', 'retreat', false, false),
  ('chicago_2024_retreat', '2024 Chicago Retreat', 'Attended the 2024 Chicago Retreat.', '🏙️', 'retreat', false, false),
  ('arkansas_2024_retreat', '2024 Arkansas Retreat', 'Attended the 2024 Arkansas Retreat.', '🏕️', 'retreat', false, false),
  ('colorado_cabin_2024_retreat', '2024 Colorado Cabin Retreat', 'Attended the 2024 Colorado Cabin Retreat.', '🏔️', 'retreat', false, false),
  ('portugal_2024_retreat', '2024 Portugal Retreat', 'Attended the 2024 Portugal Retreat.', '🏖️', 'retreat', false, false),
  ('arkansas_2025_retreat', '2025 Arkansas Retreat', 'Attended the 2025 Arkansas Retreat.', '🏕️', 'retreat', false, false),
  ('colorado_cabin_2025_retreat', '2025 Colorado Cabin Retreat', 'Attended the 2025 Colorado Cabin Retreat.', '🏔️', 'retreat', false, false),
  ('virginia_2026_retreat', '2026 Virginia Retreat', 'Attended the 2026 Virginia Retreat.', '🏡', 'retreat', false, false);
