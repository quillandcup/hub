set lock_timeout = '5s';

-- Staff notes on a member's CRM profile (Local layer, admin-only).
--
-- Ania and the team jot down what happened with someone (a DM sent, a call, a promise to follow up)
-- and want it dated and attributed on the member's page. Append-only in spirit: a note is written
-- once and never edited; a mistaken one is soft deleted (deleted_at), so history stays.
--
-- Admin only: members never see these (no member policy, and the table is not mirrored into
-- member_activities, which members can read about themselves).

CREATE TABLE public.member_admin_notes (
  id         text PRIMARY KEY DEFAULT public.new_id('mnote'),
  member_id  text NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 5000),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX member_admin_notes_member_idx ON public.member_admin_notes (member_id, created_at DESC);

COMMENT ON TABLE public.member_admin_notes IS
  'Local layer: timestamped staff notes on a member''s CRM profile. Admin only; soft deleted with deleted_at. [id prefix: mnote_]';

ALTER TABLE public.member_admin_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read notes" ON public.member_admin_notes
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins write notes" ON public.member_admin_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins soft delete notes" ON public.member_admin_notes
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.member_admin_notes FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.member_admin_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_admin_notes TO service_role;

-- Erasing a member removes the notes about them (the member_data_handling test requires a decision per member foreign key).
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('member_admin_notes', 'member_id', 'delete', 'staff notes about them');
