-- Replace the one "is_specialty" group flag with the separate things it stood for. A group
-- that isn't a real concept hides what a type actually does; each flag below drives one thing.
--   listed_in_events   shown on the member Events page
--   announced_publicly included in public marketing
--   guests_allowed     non-members may attend

ALTER TABLE prickle_types
  ADD COLUMN IF NOT EXISTS listed_in_events BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS announced_publicly BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guests_allowed BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prickle_types' AND column_name = 'is_specialty') THEN
    UPDATE prickle_types SET listed_in_events = is_specialty;
    ALTER TABLE prickle_types DROP COLUMN is_specialty;
  END IF;
END $$;

COMMENT ON COLUMN prickle_types.listed_in_events IS
  'Whether upcoming prickles of this type are listed on the member Events page (webinars, Hedgies on First, Monthly Goal Review, pitches). Admin-editable.';
COMMENT ON COLUMN prickle_types.announced_publicly IS
  'Whether prickles of this type are included in public marketing. Not read by any page yet. Admin-editable.';
COMMENT ON COLUMN prickle_types.guests_allowed IS
  'Whether non-members may attend prickles of this type. Not read by any page yet. Admin-editable.';
