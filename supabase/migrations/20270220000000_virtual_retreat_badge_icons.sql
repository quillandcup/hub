-- The virtual retreat badges all got the same computer-screen icon. Give each one an icon that
-- fits its theme. Only rows still on the placeholder are touched, so an icon an admin already
-- chose by hand is kept.

UPDATE badge_types AS b
SET icon = v.icon
FROM (VALUES
  ('winter_2022_virtual_retreat', '❄️'),
  ('spring_2022_virtual_retreat', '🪄'),
  ('autumn_2022_virtual_retreat', '🍂'),
  ('winter_2023_virtual_retreat', '✊'),
  ('spring_2023_virtual_retreat', '🌸'),
  ('summer_2023_virtual_retreat', '🧩'),
  ('autumn_2023_virtual_retreat', '🎙️'),
  ('winter_2024_virtual_retreat', '🦁'),
  ('spring_2024_virtual_retreat', '🦸'),
  ('summer_2024_virtual_retreat', '💘'),
  ('autumn_2024_virtual_retreat', '🌱'),
  ('winter_2025_virtual_retreat', '📖'),
  ('spring_2025_virtual_retreat', '💬'),
  ('autumn_2025_virtual_retreat', '💡'),
  ('winter_2026_virtual_retreat', '🏷️'),
  ('summer_2026_virtual_retreat', '🌻')
) AS v(key, icon)
WHERE b.key = v.key AND b.icon = '🖥️';
