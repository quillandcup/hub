-- Lesson comments, phase 1 (docs/product/COURSES.md, "Lesson comments"): members with current access to a course ask
-- questions on its lessons, and staff answer where they are asked. A new table only, so nothing the code live in
-- production uses changes (expand-only).
--
-- Reports, follows and unread counts are later phases and get their own migrations.

set lock_timeout = '5s';

CREATE TABLE public.lesson_comments (
  id text PRIMARY KEY DEFAULT public.new_id('cmnt'),
  lesson_id text NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  -- Null for a top-level comment. One level only: a reply points at a top-level comment on the same lesson (trigger below).
  parent_id text REFERENCES public.lesson_comments(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- Set by the server from the author's role when posted, so the badge survives a later role change.
  is_staff_reply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  deleted_at timestamptz,
  deleted_by text REFERENCES public.members(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.lesson_comments IS
  'LOCAL: a question or answer on a course lesson, plain text, one level of replies (parent_id). Visible to members with current access to the lesson''s course (and the lesson open) and to admins; soft delete (deleted_at), reversible hide (hidden_at). A member edits for 15 minutes after posting. Not reprocessed. Tier 1: notification links carry the id. [id prefix: cmnt_]';
COMMENT ON COLUMN public.lesson_comments.body IS 'Plain text as typed, 1 to 4000 characters. Never copied into analytics, logs or Sentry.';
COMMENT ON COLUMN public.lesson_comments.is_staff_reply IS 'The author was an admin when it was posted: shown as an Instructor badge.';
COMMENT ON COLUMN public.lesson_comments.deleted_by IS 'The member who deleted it (the author, or staff later).';

CREATE INDEX lesson_comments_lesson_id_created_at_idx ON public.lesson_comments (lesson_id, created_at DESC);
CREATE INDEX lesson_comments_parent_id_idx ON public.lesson_comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX lesson_comments_member_id_created_at_idx ON public.lesson_comments (member_id, created_at DESC);
-- The unanswered-questions list reads live top-level comments across lessons, oldest first.
CREATE INDEX lesson_comments_open_questions_idx ON public.lesson_comments (created_at)
  WHERE parent_id IS NULL AND deleted_at IS NULL AND hidden_at IS NULL;

------------------------------------------------------------------------------------------------
-- Threading depth: a reply points at a top-level comment on the same lesson.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lesson_comments_check_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_parent public.lesson_comments;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_parent FROM public.lesson_comments WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The comment being replied to does not exist' USING ERRCODE = '23503';
  END IF;
  IF v_parent.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'A reply goes under a top-level comment, not under another reply' USING ERRCODE = '23514';
  END IF;
  IF v_parent.lesson_id <> NEW.lesson_id THEN
    RAISE EXCEPTION 'A reply belongs to the same lesson as the comment it answers' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER lesson_comments_check_parent
  BEFORE INSERT OR UPDATE OF parent_id, lesson_id ON public.lesson_comments
  FOR EACH ROW EXECUTE FUNCTION public.lesson_comments_check_parent();

------------------------------------------------------------------------------------------------
-- What a signed-in member's own update may change (the service role, whose actions check the same rules, is not
-- restricted): their own text within 15 minutes of posting, and soft deleting it. Nothing else.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lesson_comments_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- No signed-in user (service role, SQL editor) or an admin: not restricted here.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.is_staff_reply IS DISTINCT FROM OLD.is_staff_reply
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.hidden_at IS DISTINCT FROM OLD.hidden_at THEN
    RAISE EXCEPTION 'Only the text of a comment can be edited' USING ERRCODE = '42501';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.deleted_at IS NOT NULL OR OLD.created_at <= now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'A comment can be edited for 15 minutes after it is posted' USING ERRCODE = '42501';
    END IF;
    NEW.edited_at := now();
  ELSIF NEW.edited_at IS DISTINCT FROM OLD.edited_at THEN
    RAISE EXCEPTION 'Only the text of a comment can be edited' USING ERRCODE = '42501';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    -- Deleting is one way for the author; staff undo it.
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'A deleted comment stays deleted' USING ERRCODE = '42501';
    END IF;
    NEW.deleted_by := OLD.member_id;
  ELSIF NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
    RAISE EXCEPTION 'Only the text of a comment can be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER lesson_comments_guard_update
  BEFORE UPDATE ON public.lesson_comments
  FOR EACH ROW EXECUTE FUNCTION public.lesson_comments_guard_update();

REVOKE ALL ON FUNCTION public.lesson_comments_check_parent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lesson_comments_guard_update() FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------------------------
-- Row-level security: the member pages read and write through the server (service role, scoped to the effective
-- member), so these are the second layer for a signed-in client.
------------------------------------------------------------------------------------------------

-- Whether the signed-in member may open this lesson's page: current access to the course, the lesson open, the course
-- not a draft. Staff are checked separately.
CREATE OR REPLACE FUNCTION public.can_open_lesson(p_lesson_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.course_lessons l
    JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = p_lesson_id
      AND l.state = 'open'
      AND NOT c.is_draft
      AND public.has_course_access(l.course_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.can_open_lesson(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_open_lesson(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_open_lesson(text) IS
  'Whether the signed-in member has current access to the lesson''s course and the lesson is open (not coming soon or hidden, course not a draft). Staff are checked by the caller.';

ALTER TABLE public.lesson_comments ENABLE ROW LEVEL SECURITY;

-- Members read the live comments of lessons they can open, and their own (a deleted one stays theirs to see); admins read all.
CREATE POLICY "Course members and admins read lesson_comments" ON public.lesson_comments
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR member_id = (SELECT public.current_member_id())
    OR (deleted_at IS NULL AND hidden_at IS NULL AND public.can_open_lesson(lesson_id))
  );

-- Post as yourself, on a lesson you can open (admins on any), never while an admin previews as a member (sudo is read-only).
CREATE POLICY "Course members post lesson_comments as themselves" ON public.lesson_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND deleted_at IS NULL AND hidden_at IS NULL AND edited_at IS NULL AND deleted_by IS NULL
    AND (
      (SELECT public.is_admin())
      OR (NOT is_staff_reply AND public.can_open_lesson(lesson_id))
    )
  );

-- Your own rows only (the guard trigger limits it to the text within 15 minutes and deleting). Admins act through server actions.
CREATE POLICY "Authors edit or delete their own lesson_comments" ON public.lesson_comments
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL)
  WITH CHECK (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL);

REVOKE ALL ON public.lesson_comments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lesson_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_comments TO service_role;

------------------------------------------------------------------------------------------------
-- A removal request (supabase/tests/database/member_data_handling.test.sql keeps this list complete): the comment stays so
-- the thread reads, written by the former-member placeholder.
------------------------------------------------------------------------------------------------

INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('lesson_comments', 'member_id', 'repoint', 'a comment is part of a course thread other members read; it stays, written by the former-member placeholder'),
  ('lesson_comments', 'deleted_by', 'null', 'who deleted it matters only to staff, and only while the member exists');
