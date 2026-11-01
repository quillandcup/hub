-- Per-lesson progress captured from the Kajabi admin by `npm run courses:content -- --progress`
-- (docs/COURSES.md, "Importing Kajabi per-lesson progress"). One row per (course, student email,
-- Kajabi lesson). Bronze: the capture replaces a student's rows as a snapshot; lessons no longer listed get
-- deleted_at. Admins read, only the service role writes. Natural key, no generated id, never exposed by id.

CREATE TABLE bronze.kajabi_lesson_progress (
  course_kajabi_id TEXT NOT NULL,
  -- Lowercased and trimmed; matched to members.email or an email alias, never by name.
  email TEXT NOT NULL,
  -- Kajabi's post id; equals bronze.kajabi_course_lessons.kajabi_id.
  kajabi_lesson_id TEXT NOT NULL,
  -- Kajabi's own ids for the student, kept as text (they are external ids).
  kajabi_contact_id TEXT,
  kajabi_member_id TEXT,
  completed BOOLEAN NOT NULL,
  -- Kajabi's completion date (or time) as an instant; a bare date is read as noon in the organisation's timezone.
  completed_at TIMESTAMPTZ,
  percent NUMERIC(5, 2) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when a later capture of the student no longer lists the lesson.
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (course_kajabi_id, email, kajabi_lesson_id),
  CHECK (email = lower(btrim(email)))
);

ALTER TABLE bronze.kajabi_lesson_progress ENABLE ROW LEVEL SECURITY;
-- Default privileges in this schema would otherwise hand the new table to anon and authenticated.
REVOKE ALL ON bronze.kajabi_lesson_progress FROM anon, authenticated;
GRANT SELECT ON bronze.kajabi_lesson_progress TO authenticated;
GRANT ALL ON bronze.kajabi_lesson_progress TO service_role;
CREATE POLICY "Admins can read kajabi_lesson_progress" ON bronze.kajabi_lesson_progress
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON TABLE bronze.kajabi_lesson_progress IS
  'Kajabi per-lesson completion per student email, captured from the Kajabi admin by courses:content --progress. Admin read, service role write.';

-- Silver: which lesson_progress rows the Kajabi progress step wrote, so they can be told apart and removed.
ALTER TABLE public.lesson_progress
  ADD COLUMN imported_from TEXT CHECK (imported_from IS NULL OR imported_from = 'kajabi');
COMMENT ON COLUMN public.lesson_progress.imported_from IS
  'Set to kajabi on rows created by the Kajabi progress import; null for progress the member made in the Hub.';
