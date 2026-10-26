-- Specialty prickles: every prickle type that is not an ordinary progress/sprint session
-- (webinars, Hedgies on First, Monthly Goal Review, pitches, ...). The member Events page
-- lists upcoming prickles of these types, so a new specialty type shows up there without a
-- code change. Replaces the Events page's hard-coded "educational" type.

ALTER TABLE prickle_types ADD COLUMN IF NOT EXISTS is_specialty BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN prickle_types.is_specialty IS
  'Whether prickles of this type are called out on the member Events page: a special session (webinar, Hedgies on First, Monthly Goal Review, pitch) rather than an everyday progress or sprint prickle. Admin-editable.';

UPDATE prickle_types SET is_specialty = true
  WHERE normalized_name IN ('educational', 'hedgies-on-first', 'monthly-goal-review', 'pitch', 'members-only-pitch');
