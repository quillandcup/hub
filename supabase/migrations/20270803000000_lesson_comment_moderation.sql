-- Lesson comments, phase 2 (docs/product/COURSES.md, "Lesson comments"): moderation. Members report a comment, a comment with too
-- many links is held for review, and staff hide, delete, approve, dismiss reports and mark questions handled, each as one
-- audit entry. Expand-only: new columns and a new table, and the row-level policies of phase 1 get one more condition each.
-- Nothing the code live in production uses changes meaning (the new columns are all null for every existing comment).

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- New columns on the comments.
------------------------------------------------------------------------------------------------

ALTER TABLE public.lesson_comments
  ADD COLUMN held_at timestamptz,
  ADD COLUMN held_reason text,
  ADD COLUMN handled_at timestamptz,
  ADD COLUMN handled_by text;

ALTER TABLE public.lesson_comments
  ADD CONSTRAINT lesson_comments_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.members(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.lesson_comments VALIDATE CONSTRAINT lesson_comments_handled_by_fkey;

COMMENT ON COLUMN public.lesson_comments.held_at IS 'Held for staff review when posted (more than two links): only its author and staff see it until staff approve it (held_at back to null).';
COMMENT ON COLUMN public.lesson_comments.held_reason IS 'Why it was held. Only ''links'' today.';
COMMENT ON COLUMN public.lesson_comments.handled_at IS 'Staff marked a question as needing no answer: it leaves the unanswered list.';
COMMENT ON COLUMN public.lesson_comments.handled_by IS 'The member (staff) who marked it handled.';
COMMENT ON COLUMN public.lesson_comments.hidden_at IS 'Hidden by staff (reversible): members see a tombstone, staff the text. Set only by moderate_lesson_comment().';

------------------------------------------------------------------------------------------------
-- The signed-in member's own update may still change only the text and delete: the new columns are staff's.
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
     OR NEW.hidden_at IS DISTINCT FROM OLD.hidden_at
     OR NEW.held_at IS DISTINCT FROM OLD.held_at
     OR NEW.held_reason IS DISTINCT FROM OLD.held_reason
     OR NEW.handled_at IS DISTINCT FROM OLD.handled_at
     OR NEW.handled_by IS DISTINCT FROM OLD.handled_by THEN
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

------------------------------------------------------------------------------------------------
-- Row-level security on the comments: a held comment is its author's and staff's alone, and nobody posts one as held-free
-- or handled from a signed-in client (the server posts a held comment with the service role).
------------------------------------------------------------------------------------------------

DROP POLICY "Course members and admins read lesson_comments" ON public.lesson_comments;
CREATE POLICY "Course members and admins read lesson_comments" ON public.lesson_comments
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR member_id = (SELECT public.current_member_id())
    OR (deleted_at IS NULL AND hidden_at IS NULL AND held_at IS NULL AND public.can_open_lesson(lesson_id))
  );

DROP POLICY "Course members post lesson_comments as themselves" ON public.lesson_comments;
CREATE POLICY "Course members post lesson_comments as themselves" ON public.lesson_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND deleted_at IS NULL AND hidden_at IS NULL AND held_at IS NULL AND handled_at IS NULL AND edited_at IS NULL AND deleted_by IS NULL
    AND (
      (SELECT public.is_admin())
      OR (NOT is_staff_reply AND public.can_open_lesson(lesson_id))
    )
  );

------------------------------------------------------------------------------------------------
-- Reports.
------------------------------------------------------------------------------------------------

CREATE TABLE public.lesson_comment_reports (
  id text PRIMARY KEY DEFAULT public.new_id('cmrp'),
  comment_id text NOT NULL REFERENCES public.lesson_comments(id) ON DELETE CASCADE,
  reporter_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text REFERENCES public.members(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.lesson_comment_reports IS
  'LOCAL: a member''s report of a lesson comment, with a short reason. One open report per reporter and comment. Read by admins only; the comment''s author is never told who reported. Resolved by staff (hide or delete the comment, or dismiss the report) through moderate_lesson_comment(). Tier 2: the id is never shown. [id prefix: cmrp_]';
COMMENT ON COLUMN public.lesson_comment_reports.reason IS 'What the reporter typed, 1 to 500 characters. Staff read it; never copied into analytics, logs or Sentry.';

CREATE UNIQUE INDEX lesson_comment_reports_one_open_idx ON public.lesson_comment_reports (comment_id, reporter_id) WHERE resolved_at IS NULL;
CREATE INDEX lesson_comment_reports_comment_id_idx ON public.lesson_comment_reports (comment_id);
CREATE INDEX lesson_comment_reports_reporter_id_idx ON public.lesson_comment_reports (reporter_id);
CREATE INDEX lesson_comment_reports_open_idx ON public.lesson_comment_reports (created_at) WHERE resolved_at IS NULL;

ALTER TABLE public.lesson_comment_reports ENABLE ROW LEVEL SECURITY;

-- Staff read them; nobody else, not even the reporter.
CREATE POLICY "Admins read lesson_comment_reports" ON public.lesson_comment_reports
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

-- Report as yourself, someone else's live comment on a lesson you can open, never while an admin previews as a member.
CREATE POLICY "Course members report lesson_comments as themselves" ON public.lesson_comment_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND resolved_at IS NULL AND resolved_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.lesson_comments c
      WHERE c.id = comment_id
        AND c.member_id <> reporter_id
        AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND c.held_at IS NULL
        AND public.can_open_lesson(c.lesson_id)
    )
  );

REVOKE ALL ON public.lesson_comment_reports FROM anon, authenticated;
GRANT SELECT, INSERT ON public.lesson_comment_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_comment_reports TO service_role;

INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('lesson_comment_reports', 'reporter_id', 'delete', 'a report is the reporter''s own and staff-only; it goes with them'),
  ('lesson_comment_reports', 'resolved_by', 'null', 'who resolved it matters only to staff, and only while the member exists'),
  ('lesson_comments', 'handled_by', 'null', 'who marked it handled matters only to staff, and only while the member exists');

------------------------------------------------------------------------------------------------
-- Staff actions: one function, one audit entry per action, written as the person who did it. There is deliberately no
-- row-level audit trigger on lesson_comments (it would copy every comment's text into the audit log), and the entry
-- holds no text either: the comment's id, its lesson's title, and what changed.
--   hide / unhide: the comment's visibility (a hide resolves its open reports)
--   delete:        soft delete, deleted_by the acting admin (resolves its open reports)
--   approve:       release a held comment
--   handle:        a question needs no answer
--   dismiss:       resolve the open reports without touching the comment
-- Returns 'done', 'no_change' (already so, nothing written) or 'not_found'.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.moderate_lesson_comment(p_comment_id text, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c public.lesson_comments;
  v_actor text;
  v_old text;
  v_new text;
  v_open integer := 0;
  v_changes jsonb := '{}'::jsonb;
  v_label text;
  v_handled boolean := false;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('hide', 'unhide', 'delete', 'approve', 'handle', 'dismiss') THEN
    RAISE EXCEPTION 'unknown_action';
  END IF;

  SELECT * INTO c FROM public.lesson_comments WHERE id = p_comment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  v_actor := public.current_member_id();
  v_old := CASE WHEN c.deleted_at IS NOT NULL THEN 'deleted' WHEN c.hidden_at IS NOT NULL THEN 'hidden' WHEN c.held_at IS NOT NULL THEN 'held' ELSE 'visible' END;

  IF p_action = 'hide' THEN
    IF c.deleted_at IS NOT NULL OR c.hidden_at IS NOT NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET hidden_at = now() WHERE id = c.id;
  ELSIF p_action = 'unhide' THEN
    IF c.deleted_at IS NOT NULL OR c.hidden_at IS NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET hidden_at = NULL WHERE id = c.id;
  ELSIF p_action = 'delete' THEN
    IF c.deleted_at IS NOT NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET deleted_at = now(), deleted_by = v_actor WHERE id = c.id;
  ELSIF p_action = 'approve' THEN
    IF c.deleted_at IS NOT NULL OR c.held_at IS NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET held_at = NULL, held_reason = NULL WHERE id = c.id;
  ELSIF p_action = 'handle' THEN
    IF c.parent_id IS NOT NULL OR c.deleted_at IS NOT NULL OR c.handled_at IS NOT NULL THEN RETURN 'no_change'; END IF;
    UPDATE public.lesson_comments SET handled_at = now(), handled_by = v_actor WHERE id = c.id;
    v_handled := true;
  END IF;

  -- Hiding or deleting settles what was reported; dismissing settles it without touching the comment.
  IF p_action IN ('hide', 'delete', 'dismiss') THEN
    WITH settled AS (
      UPDATE public.lesson_comment_reports SET resolved_at = now(), resolved_by = v_actor
      WHERE comment_id = c.id AND resolved_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_open FROM settled;
    IF p_action = 'dismiss' AND v_open = 0 THEN RETURN 'no_change'; END IF;
  END IF;

  SELECT CASE WHEN x.deleted_at IS NOT NULL THEN 'deleted' WHEN x.hidden_at IS NOT NULL THEN 'hidden' WHEN x.held_at IS NOT NULL THEN 'held' ELSE 'visible' END
    INTO v_new FROM public.lesson_comments x WHERE x.id = c.id;
  IF v_new IS DISTINCT FROM v_old THEN
    v_changes := v_changes || jsonb_build_object('visibility', jsonb_build_object('old', v_old, 'new', v_new));
  END IF;
  IF v_handled THEN
    v_changes := v_changes || jsonb_build_object('handled', jsonb_build_object('old', false, 'new', true));
  END IF;
  IF v_open > 0 THEN
    v_changes := v_changes || jsonb_build_object('reports_resolved', jsonb_build_object('old', v_open, 'new', 0));
  END IF;

  SELECT l.title INTO v_label FROM public.course_lessons l WHERE l.id = c.lesson_id;
  INSERT INTO public.audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, entity_label)
  VALUES (
    auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'staff' END, public.current_acting_as_member_id(),
    'lesson_comment', c.id, 'update', v_changes, v_label
  );
  RETURN 'done';
END;
$function$;

REVOKE ALL ON FUNCTION public.moderate_lesson_comment(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_lesson_comment(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.moderate_lesson_comment(text, text) IS
  'Staff moderation of a lesson comment (hide, unhide, delete, approve, handle, dismiss): checks the caller is an admin (or the service role), changes the comment, settles its open reports and writes ONE audit entry (no comment text). See docs/product/COURSES.md, "Lesson comments".';
