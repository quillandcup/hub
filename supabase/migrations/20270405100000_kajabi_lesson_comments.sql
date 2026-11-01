-- Lesson comments captured from Kajabi's member lesson pages by `npm run courses:content -- --comments`
-- (docs/COURSES.md, "Lesson comments"). One row per comment or reply. Bronze: the capture replaces a lesson's
-- comments as a snapshot; comments no longer listed get deleted_at. Admins read, only the service role writes.
-- Natural key, no generated id, never exposed by id.

set lock_timeout = '5s';

CREATE TABLE bronze.kajabi_lesson_comments (
  course_kajabi_id TEXT NOT NULL,
  -- Kajabi's post id; equals bronze.kajabi_course_lessons.kajabi_id.
  lesson_kajabi_id TEXT NOT NULL,
  -- Kajabi's comment id when the page carries one, otherwise a hash of lesson, author name, time and text.
  comment_key TEXT NOT NULL,
  -- The comment this one replies to (replies nest one level), null for a top-level comment.
  parent_comment_key TEXT,
  -- The displayed name only: Kajabi's page has no author id, email or profile link, and members are never matched by name.
  author_name TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  -- Plain text with newlines kept; never HTML.
  body TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when a later capture of the lesson no longer lists the comment.
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (lesson_kajabi_id, comment_key)
);

ALTER TABLE bronze.kajabi_lesson_comments ENABLE ROW LEVEL SECURITY;
-- Default privileges in this schema would otherwise hand the new table to anon and authenticated.
REVOKE ALL ON bronze.kajabi_lesson_comments FROM anon, authenticated;
GRANT SELECT ON bronze.kajabi_lesson_comments TO authenticated;
GRANT ALL ON bronze.kajabi_lesson_comments TO service_role;
CREATE POLICY "Admins can read kajabi_lesson_comments" ON bronze.kajabi_lesson_comments
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON TABLE bronze.kajabi_lesson_comments IS
  'Kajabi lesson comments and replies, captured from the member lesson pages by courses:content --comments. Holds members'' names and words (personal data): admin read, service role write, never logged.';
