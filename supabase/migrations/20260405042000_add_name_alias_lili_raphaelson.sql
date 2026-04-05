-- Add name alias for lili -> Lili Raphaelson
-- Fixes matching issue where Zoom attendee "lili" wasn't matching to the member

DO $$
DECLARE
  lili_id UUID;
BEGIN
  -- Get Lili Raphaelson's member ID
  SELECT id INTO lili_id FROM members WHERE email = 'member9@example.com';

  -- Only insert if member exists and alias doesn't already exist
  IF lili_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_name_aliases WHERE member_id = lili_id AND alias = 'lili'
  ) THEN
    INSERT INTO member_name_aliases (member_id, alias)
    VALUES (lili_id, 'lili');
  END IF;
END $$;
