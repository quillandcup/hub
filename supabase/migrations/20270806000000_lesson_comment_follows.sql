-- Lesson comments, phase 3 (docs/product/COURSES.md, "Lesson comments"): notifications. Two new tables, nothing existing changes.
--   lesson_comment_follows: who follows a lesson's thread (posting or replying follows it; rows hold explicit and automatic
--     choices, and unfollowing is following = false), for the daily digest of new activity and for instructor replies.
--   lesson_comment_reads: when a member last looked at a lesson's thread, for "N new" counts.
-- Both are the member's own rows: read and written as themselves, never while an admin previews as them (sudo).

set lock_timeout = '5s';

CREATE TABLE public.lesson_comment_follows (
  id text PRIMARY KEY DEFAULT public.new_id('cmfw'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  following boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, lesson_id)
);

COMMENT ON TABLE public.lesson_comment_follows IS
  'LOCAL: a member''s choice to follow (or not follow) the comment thread of a lesson. Posting or replying creates a following row unless the member already chose; unfollowing sets following = false. Followers get the daily digest of new activity and instructors'' replies. Member-written, read-only in sudo. Tier 2: the id is never shown. [id prefix: cmfw_]';

CREATE INDEX lesson_comment_follows_lesson_id_idx ON public.lesson_comment_follows (lesson_id) WHERE following;

CREATE TABLE public.lesson_comment_reads (
  id text PRIMARY KEY DEFAULT public.new_id('cmrd'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, lesson_id)
);

COMMENT ON TABLE public.lesson_comment_reads IS
  'LOCAL: when a member last opened a lesson''s comment thread, so the thread can say how many comments are new since. Member-written, read-only in sudo. Tier 2: the id is never shown. [id prefix: cmrd_]';

ALTER TABLE public.lesson_comment_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_comment_reads ENABLE ROW LEVEL SECURITY;

-- Your own rows. Writing needs the lesson to be one you can open, and never while an admin previews as you.
CREATE POLICY "Members read their own lesson_comment_follows" ON public.lesson_comment_follows
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

CREATE POLICY "Members follow lesson threads as themselves" ON public.lesson_comment_follows
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND public.can_open_lesson(lesson_id)
  );

CREATE POLICY "Members change their own lesson_comment_follows" ON public.lesson_comment_follows
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL)
  WITH CHECK (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL);

CREATE POLICY "Members read their own lesson_comment_reads" ON public.lesson_comment_reads
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

CREATE POLICY "Members mark lesson threads read as themselves" ON public.lesson_comment_reads
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND public.can_open_lesson(lesson_id)
  );

CREATE POLICY "Members change their own lesson_comment_reads" ON public.lesson_comment_reads
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL)
  WITH CHECK (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL);

REVOKE ALL ON public.lesson_comment_follows FROM anon, authenticated;
REVOKE ALL ON public.lesson_comment_reads FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lesson_comment_follows TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lesson_comment_reads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_comment_follows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_comment_reads TO service_role;

-- A removal request (supabase/tests/database/member_data_handling.test.sql keeps this list complete): a follow and a
-- last-seen time are the member's own and mean nothing without them.
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('lesson_comment_follows', 'member_id', 'delete', 'a follow is the member''s own choice and means nothing without them'),
  ('lesson_comment_reads', 'member_id', 'delete', 'when a member last read a thread is theirs alone');
