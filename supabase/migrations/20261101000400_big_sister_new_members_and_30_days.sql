-- Big Sisters for every new member, not just trial members (follow-up to 20261101000000..300).
--
-- 1. Every new member gets a big sister for 30 days: a trial, a direct sign-up, someone rejoining
--    after time away, or someone arriving through a program that includes membership (180
--    Program, Ready Writers...). Programs that don't include membership (Self-Editing Academy)
--    don't. So `trial_member_id`/`trial_started_on` become `new_member_id`/`started_on`, and
--    `kind` records how they arrived. Nobody types a start date: it comes from the sign-up or
--    cohort itself (lib/arrivals.ts), and a trial's end from Stripe.
-- 2. A returning member gets a new match for their new arrival, so uniqueness is per arrival
--    (new member + start date) instead of per member.
-- 3. programs.includes_membership says which programs count as joining.
-- 4. The big sister records why a trial didn't continue: my_mentorships also hands the big sister
--    the mentee's note and membership dates (server-side only, to work out whether a reason is
--    needed), and set_mentorship_note lets the big sister of a match, and only that one (or an
--    admin), write its note.

ALTER TABLE mentorships RENAME COLUMN trial_member_id TO new_member_id;
ALTER TABLE mentorships RENAME COLUMN trial_started_on TO started_on;
ALTER TABLE mentorships RENAME CONSTRAINT mentorships_trial_member_id_fkey TO mentorships_new_member_id_fkey;
ALTER INDEX idx_mentorships_trial_started_on RENAME TO idx_mentorships_started_on;

-- Everything recorded so far came from the trial program (the old spreadsheet), so it is 'trial'.
ALTER TABLE mentorships
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'trial' CHECK (kind IN ('trial', 'direct', 'program'));
COMMENT ON COLUMN mentorships.kind IS
  'How the new member arrived: trial (a Stripe trial), direct (a membership with no trial), program (a program that includes membership).';
COMMENT ON COLUMN mentorships.started_on IS
  'The day their membership began (sign-up, or the program cohort''s start). Derived from the data (lib/arrivals.ts), not typed. The mentorship runs 30 days from here.';

DROP INDEX mentorships_one_active_match_per_trial_member;
CREATE UNIQUE INDEX mentorships_one_active_match_per_arrival
  ON mentorships (new_member_id, started_on) WHERE status = 'matched';

ALTER TABLE programs ADD COLUMN includes_membership BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN programs.includes_membership IS
  'Joining this program makes someone a member, so they get a Big Sister. false for a course that doesn''t include membership (Self-Editing Academy).';
UPDATE programs SET includes_membership = false WHERE slug = 'self-editing-academy';

-- Badge counts: the matches whose start has passed (same rule, renamed column).
CREATE OR REPLACE FUNCTION mentorship_counts()
RETURNS TABLE (member_id UUID, mentored_count INTEGER, first_started_on DATE, last_started_on DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.mentor_member_id, count(*)::integer, min(m.started_on), max(m.started_on)
    FROM mentorships m
   WHERE m.status = 'matched' AND m.started_on <= current_date
   GROUP BY m.mentor_member_id;
$$;

-- What a member sees of their own matches. A big sister also gets the mentee's note and
-- membership facts, so the app can tell whether the mentee stayed and ask why not; they are
-- only ever used server-side to work that out. A new member gets none of that.
DROP FUNCTION my_mentorships(UUID);
CREATE FUNCTION my_mentorships(p_member_id UUID)
RETURNS TABLE (
  mentorship_id UUID,
  viewer_role TEXT,
  other_member_id UUID,
  other_name TEXT,
  other_display_name TEXT,
  other_photo_url TEXT,
  started_on DATE,
  trial_ends_on DATE,
  kind TEXT,
  outcome_note TEXT,
  other_status TEXT,
  other_first_joined_at DATE,
  other_most_recent_joined_at DATE
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.id,
    CASE WHEN m.mentor_member_id = p_member_id THEN 'big_sister' ELSE 'new_member' END,
    o.id, o.name, o.display_name, o.photo_url,
    m.started_on, m.trial_ends_on, m.kind,
    CASE WHEN m.mentor_member_id = p_member_id THEN m.outcome_note END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.status END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.first_joined_at END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.most_recent_joined_at END
  FROM mentorships m
  JOIN members o ON o.id = CASE WHEN m.mentor_member_id = p_member_id THEN m.new_member_id ELSE m.mentor_member_id END
  WHERE m.status = 'matched'
    AND (m.mentor_member_id = p_member_id OR m.new_member_id = p_member_id)
    AND (p_member_id = current_member_id() OR is_admin())
  ORDER BY m.started_on DESC;
$$;

REVOKE EXECUTE ON FUNCTION my_mentorships(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_mentorships(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION my_mentorships(UUID) IS
  'The caller''s own Big Sister matches (viewer_role = the caller''s side). A big sister also gets the mentee''s note and membership dates. SECURITY DEFINER because mentorships is admin-only.';

-- A big sister writes the reason a trial didn't continue on their own match: only the note, only theirs.
CREATE OR REPLACE FUNCTION set_mentorship_note(p_mentorship_id UUID, p_note TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updated INTEGER;
BEGIN
  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
    RAISE EXCEPTION 'note too long' USING ERRCODE = '22001';
  END IF;
  UPDATE mentorships
     SET outcome_note = NULLIF(btrim(p_note), '')
   WHERE id = p_mentorship_id
     AND status = 'matched'
     AND (mentor_member_id = current_member_id() OR is_admin());
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_mentorship_note(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_mentorship_note(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION set_mentorship_note(UUID, TEXT) IS
  'Sets outcome_note on a match, for that match''s big sister (or an admin). Returns false when there is no such match for the caller.';
