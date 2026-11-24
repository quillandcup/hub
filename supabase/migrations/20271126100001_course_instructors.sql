-- Course instructors (docs/product/COURSES.md, "Lesson comments"): the Instructor badge on a lesson comment means the author is one of
-- THIS course's instructors, not "an admin". A course has a list of instructors (members), edited by staff in the course settings.
-- Expand-only: one new table, a changed meaning for an existing column (no rename: the column keeps its name so the code live during
-- a deploy keeps working), and a one-time reset of the stored flags, which meant "was staff" and will be set again from the list.
--   * course_instructors: one row per course and member, written by admins as themselves (so the audit log names them).
--   * lesson_comments.is_staff_reply: now "the author is an instructor of the lesson's course". The server computes it when a
--     comment is posted and in the Kajabi import, and recomputes a course's comments when its instructors change.

set lock_timeout = '5s';

CREATE TABLE public.course_instructors (
  id text PRIMARY KEY DEFAULT public.new_id('cinst'),
  course_id text NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, member_id)
);

CREATE INDEX course_instructors_member_id_idx ON public.course_instructors (member_id);

COMMENT ON TABLE public.course_instructors IS
  'LOCAL: the members who teach a course. A lesson comment by one of them carries the Instructor badge, answers a question, and sends the "an instructor replied" notification; a comment by anyone else (staff included) does not. Edited by admins in the course settings. Tier 2: the id is never shown. [id prefix: cinst_]';

ALTER TABLE public.course_instructors ENABLE ROW LEVEL SECURITY;

-- Admins read all; a member reads the instructors of a course they currently have access to (the thread shows who teaches it).
CREATE POLICY "Admins and course members read course_instructors" ON public.course_instructors
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR public.has_course_access(course_id));

CREATE POLICY "Admins add course_instructors" ON public.course_instructors
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins remove course_instructors" ON public.course_instructors
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON public.course_instructors FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.course_instructors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_instructors TO service_role;

-- One audit entry per instructor added or removed, written as the admin who did it (their own client; the service role's own
-- writes, such as a test or a script, are not a person's action).
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.course_instructors
  FOR EACH ROW WHEN (auth.uid() IS NOT NULL)
  EXECUTE FUNCTION public.audit_row_change('course_instructor', 'id');

-- The Activity Log names an instructor entry by its course: audit_entity_label() as of 20271124000000, plus the 'course_instructor' case.
CREATE OR REPLACE FUNCTION public.audit_entity_label(entity text, subject jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT left(COALESCE(
        CASE entity
            WHEN 'member_badge' THEN (SELECT b.name FROM badge_types b WHERE b.id = (subject ->> 'badge_type_id'))
            WHEN 'event' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'id'))
            WHEN 'event_attendee' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'event_photo' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'segment_member' THEN (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id'))
            WHEN 'feature_flag' THEN subject ->> 'feature_key'
            WHEN 'user_feature_preview' THEN subject ->> 'feature_key'
            WHEN 'feature_flag_segment' THEN
                concat_ws(' · ', subject ->> 'feature_key', (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id')))
            WHEN 'program_cohort' THEN
                concat_ws(' · ', (SELECT p.name FROM programs p WHERE p.id = (subject ->> 'program_id')), subject ->> 'name')
            WHEN 'program_enrollment' THEN
                (SELECT concat_ws(' · ', p.name, c.name) FROM program_cohorts c JOIN programs p ON p.id = c.program_id
                  WHERE c.id = (subject ->> 'cohort_id')::uuid)
            WHEN 'prickle_schedule' THEN
                concat_ws(' · ', (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id')), subject ->> 'month')
            WHEN 'prickle_host_vibe' THEN (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id'))
            WHEN 'user_profile' THEN subject ->> 'email'
            WHEN 'user_role' THEN (SELECT up.email FROM user_profiles up WHERE up.id = (subject ->> 'user_id')::uuid)
            WHEN 'member_email_alias' THEN subject ->> 'alias_email'
            WHEN 'member_status_override' THEN subject ->> 'override_type'
            WHEN 'ignored_slack_user' THEN subject ->> 'user_id'
            WHEN 'quiz' THEN (SELECT l.title FROM course_lessons l WHERE l.id = (subject ->> 'lesson_id'))
            WHEN 'course_instructor' THEN (SELECT c.title FROM courses c WHERE c.id = (subject ->> 'course_id'))
        END,
        NULLIF(subject ->> 'title', ''), NULLIF(subject ->> 'name', ''),
        NULLIF(subject ->> 'alias', ''), NULLIF(subject ->> 'award_name', '')), 120);
$function$;

-- A removal request (supabase/tests/database/member_data_handling.test.sql keeps this list complete): an instructor entry means
-- nothing without the member.
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('course_instructors', 'member_id', 'delete', 'being an instructor of a course means nothing without the member');

------------------------------------------------------------------------------------------------
-- The flag's new meaning. The stored values meant "was staff when it was written", which is not what the badge says; they are
-- set again from each course's instructors (the server does it when instructors are saved, and the Kajabi import when it runs).
-- Until a course has instructors, none of its comments shows the badge.
------------------------------------------------------------------------------------------------

COMMENT ON COLUMN public.lesson_comments.is_staff_reply IS
  'The author was one of the lesson''s course''s instructors (course_instructors) when it was posted or last recomputed: shown as an Instructor badge, counts as an answer to a question, sends the "an instructor replied" notification. Set by the server, never by a member. The name is older than its meaning: staff who are not instructors of the course do not set it.';

UPDATE public.lesson_comments SET is_staff_reply = false WHERE is_staff_reply;
