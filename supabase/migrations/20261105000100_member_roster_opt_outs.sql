-- "Who's coming" on an upcoming prickle's page lists the members who committed to it or added it to
-- their calendar (lib/prickle-roster.ts). A member who'd rather not be listed opts out here: a row
-- means hidden from other members' lists (they still see themselves, marked as hidden).
--
-- LOCAL layer: owned by this app, normal CRUD. The roster itself is read with the service role,
-- since commitments and calendar items are private to each member; this table is the member's
-- own switch for it.

CREATE TABLE member_roster_opt_outs (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE member_roster_opt_outs IS
  'LOCAL: a row = the member opted out of appearing in other members'' "Who''s coming" lists on upcoming prickles (committed or added to calendar). Own row or admin.';

ALTER TABLE member_roster_opt_outs ENABLE ROW LEVEL SECURITY;

-- Owner via current_member_id(), admin via is_admin() (which also covers sudo, since a sudo'd
-- request runs under the real admin's session). Same conventions as 20260926000600.
CREATE POLICY "View own roster opt-out, admins view all" ON member_roster_opt_outs
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Add own roster opt-out, admins add any" ON member_roster_opt_outs
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Remove own roster opt-out, admins remove any" ON member_roster_opt_outs
  FOR DELETE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
