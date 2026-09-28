-- Private "notes to self" one member keeps about another (Local layer, member-owned).
--
-- Founding-hedgies feedback: like jotting down what you want to follow up on after meeting
-- someone. One free-form note per (author, subject) pair, shown only to its author on the
-- subject's profile page.
--
-- Strictly private: every policy is author-only, with NO is_admin() branch -- unlike the other
-- member-owned tables, admins can't read these over the API either. Sudo is an app-layer cookie
-- invisible to Postgres, so during sudo current_member_id() is the admin's own member; the app
-- hides notes while sudo is active rather than show or write the admin's notes on someone
-- else's view. (The service role bypasses RLS as always; nothing in the app reads this table with it.)
--
-- Clearing a note deletes the row. ON DELETE CASCADE on both sides: a note means nothing
-- without its author or its subject.

CREATE TABLE IF NOT EXISTS public.member_notes (
  author_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  subject_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (author_member_id, subject_member_id),
  CHECK (author_member_id <> subject_member_id)
);

-- The PK covers lookups by author; this one serves the subject-side FK cascade.
CREATE INDEX IF NOT EXISTS member_notes_subject_member_id_idx ON public.member_notes (subject_member_id);

COMMENT ON TABLE public.member_notes IS
  'Local layer: a member''s private notes to self about another member. Author-only under RLS (no admin access); hidden in sudo mode by the app.';

DROP TRIGGER IF EXISTS update_member_notes_updated_at ON public.member_notes;
CREATE TRIGGER update_member_notes_updated_at
  BEFORE UPDATE ON public.member_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.member_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own notes" ON public.member_notes;
CREATE POLICY "Members read own notes" ON public.member_notes
  FOR SELECT TO authenticated
  USING (author_member_id = (SELECT public.current_member_id()));

DROP POLICY IF EXISTS "Members insert own notes" ON public.member_notes;
CREATE POLICY "Members insert own notes" ON public.member_notes
  FOR INSERT TO authenticated
  WITH CHECK (author_member_id = (SELECT public.current_member_id()));

DROP POLICY IF EXISTS "Members update own notes" ON public.member_notes;
CREATE POLICY "Members update own notes" ON public.member_notes
  FOR UPDATE TO authenticated
  USING (author_member_id = (SELECT public.current_member_id()))
  WITH CHECK (author_member_id = (SELECT public.current_member_id()));

DROP POLICY IF EXISTS "Members delete own notes" ON public.member_notes;
CREATE POLICY "Members delete own notes" ON public.member_notes
  FOR DELETE TO authenticated
  USING (author_member_id = (SELECT public.current_member_id()));

REVOKE ALL ON public.member_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_notes TO authenticated;
GRANT ALL ON public.member_notes TO service_role;
