-- What a member can see of their own Big Sister matches (the Big Sister card on the dashboard and
-- /big-sisters). `mentorships` is admin-only because it names trial members and holds outcome
-- notes, so members read through this function instead: only the caller's own matches, and only
-- who the other person is and the trial dates. Never the outcome note or whether they converted.
-- An admin may ask for any member's (sudo views the app as that member).

CREATE OR REPLACE FUNCTION my_mentorships(p_member_id UUID)
RETURNS TABLE (
  viewer_role TEXT,
  other_member_id UUID,
  other_name TEXT,
  other_display_name TEXT,
  other_photo_url TEXT,
  trial_started_on DATE,
  trial_ends_on DATE
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE WHEN m.mentor_member_id = p_member_id THEN 'big_sister' ELSE 'trial_member' END,
    o.id, o.name, o.display_name, o.photo_url,
    m.trial_started_on, m.trial_ends_on
  FROM mentorships m
  JOIN members o ON o.id = CASE WHEN m.mentor_member_id = p_member_id THEN m.trial_member_id ELSE m.mentor_member_id END
  WHERE m.status = 'matched'
    AND (m.mentor_member_id = p_member_id OR m.trial_member_id = p_member_id)
    AND (p_member_id = current_member_id() OR is_admin())
  ORDER BY m.trial_started_on DESC;
$$;

REVOKE EXECUTE ON FUNCTION my_mentorships(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_mentorships(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION my_mentorships(UUID) IS
  'The caller''s own Big Sister matches (viewer_role = the caller''s side) with the other member''s name and photo and the trial dates. SECURITY DEFINER because mentorships is admin-only.';
