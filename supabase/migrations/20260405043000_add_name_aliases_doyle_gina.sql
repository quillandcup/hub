-- Add name aliases for common Zoom name variations
-- Fixes matching issues where Zoom attendees use shortened/different names

DO $$
DECLARE
  jehdoyle_id UUID;
  gina_id UUID;
BEGIN
  -- Get member IDs
  SELECT id INTO jehdoyle_id FROM members WHERE email = 'member10@example.com';
  SELECT id INTO gina_id FROM members WHERE email = 'member11@example.com';

  -- Add aliases (only if member exists and alias doesn't already exist)

  -- Member 10 -> jehdoyle
  IF jehdoyle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_name_aliases WHERE member_id = jehdoyle_id AND alias = 'Member 10'
  ) THEN
    INSERT INTO member_name_aliases (member_id, alias)
    VALUES (jehdoyle_id, 'Member 10');
  END IF;

  -- Member 10 -> jehdoyle
  IF jehdoyle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_name_aliases WHERE member_id = jehdoyle_id AND alias = 'Member 10'
  ) THEN
    INSERT INTO member_name_aliases (member_id, alias)
    VALUES (jehdoyle_id, 'Member 10');
  END IF;

  -- Gina -> Gina R. Briggs
  IF gina_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_name_aliases WHERE member_id = gina_id AND alias = 'Gina'
  ) THEN
    INSERT INTO member_name_aliases (member_id, alias)
    VALUES (gina_id, 'Gina');
  END IF;
END $$;
