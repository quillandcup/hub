-- Big Sister (mentor) program: each trial member is matched with an existing member who
-- shows them around for their first month. This replaces the Google Sheet the program was
-- tracked in.
--
-- LOCAL layer: operational data owned by the app, never reprocessed. One row per match.
-- Whether the trial member converted is NOT stored: it's derived at read time from membership
-- history (lib/mentorship.ts), so it can't drift from Kajabi/Stripe. `outcome_note` is the one
-- human fact the data can't tell us (why they didn't convert, or how it went).
--
-- A trial member has one big sister at a time: the partial unique index lets a re-match happen
-- only after the old row is marked 'reassigned'. A big sister taking on more than one trial
-- member at once is allowed (the admin UI warns, since the program prefers one at a time).

CREATE TABLE mentorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trial_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trial_started_on DATE NOT NULL,
  -- 'matched' counts toward the big sister's badge and conversion stats; 'reassigned' is a
  -- match that fell through (mentor unavailable, trial member never showed): kept for history.
  status TEXT NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'reassigned')),
  outcome_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mentor_member_id <> trial_member_id)
);

CREATE UNIQUE INDEX mentorships_one_active_match_per_trial_member
  ON mentorships (trial_member_id) WHERE status = 'matched';
CREATE INDEX idx_mentorships_mentor ON mentorships (mentor_member_id);
CREATE INDEX idx_mentorships_trial_started_on ON mentorships (trial_started_on);

CREATE TRIGGER mentorships_updated_at
  BEFORE UPDATE ON mentorships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE mentorships IS
  'LOCAL: Big Sister program matches (mentor member -> trial member). Conversion is derived from membership history, not stored. Not reprocessed. Admin only: mentees and outcome notes are private.';
COMMENT ON COLUMN mentorships.outcome_note IS
  'Why the trial member did or did not convert, in staff''s words. Admin only.';

ALTER TABLE mentorships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage mentorships"
  ON mentorships FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON mentorships
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('mentorship', 'id');

-- How many trial members each big sister has mentored: the input to the Big Sister badge, which
-- shows on any member's profile. Members can't read `mentorships` (it names the mentees), so the
-- count comes through this function, which returns nothing but mentor ids and counts. A match
-- counts once the trial has started.
CREATE OR REPLACE FUNCTION mentorship_counts()
RETURNS TABLE (member_id UUID, mentored_count INTEGER, first_started_on DATE, last_started_on DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.mentor_member_id, count(*)::integer, min(m.trial_started_on), max(m.trial_started_on)
    FROM mentorships m
   WHERE m.status = 'matched' AND m.trial_started_on <= current_date
   GROUP BY m.mentor_member_id;
$$;

REVOKE EXECUTE ON FUNCTION mentorship_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mentorship_counts() TO authenticated, service_role;

COMMENT ON FUNCTION mentorship_counts() IS
  'Mentor id -> matches whose trial has started (status matched). SECURITY DEFINER so any member can see badge counts without reading mentorships.';

-- The Hedgie Mentor badge was awarded by hand; it is now computed from mentorships (see
-- lib/badges.ts), renamed to match what the program is called, with higher tiers. Awards
-- already in member_badges still count (the larger of the two numbers wins, since they
-- describe the same mentoring), so nobody loses a level.
UPDATE badge_types
   SET name = 'Big Sister',
       description = 'Mentored a new member through their first month.',
       is_automatic = true
 WHERE key = 'hedgie_mentor';

UPDATE badge_levels SET name = 'Big Sister'
 WHERE level = 1 AND badge_type_id = (SELECT id FROM badge_types WHERE key = 'hedgie_mentor');
UPDATE badge_levels SET name = '2x Big Sister'
 WHERE level = 2 AND badge_type_id = (SELECT id FROM badge_types WHERE key = 'hedgie_mentor');
UPDATE badge_levels SET name = '5x Big Sister'
 WHERE level = 3 AND badge_type_id = (SELECT id FROM badge_types WHERE key = 'hedgie_mentor');

INSERT INTO badge_levels (badge_type_id, level, name, threshold)
SELECT id, 4, '10x Big Sister', 10 FROM badge_types WHERE key = 'hedgie_mentor'
UNION ALL
SELECT id, 5, '25x Big Sister', 25 FROM badge_types WHERE key = 'hedgie_mentor'
ON CONFLICT (badge_type_id, level) DO NOTHING;
