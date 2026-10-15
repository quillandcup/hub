-- The Big Sister volunteer pool, like hosts: members who've said they're happy to look after a
-- new member. Staff matching a trial member see the volunteers first (lib/big-sister-volunteers.ts
-- ranks them by who has the fewest trial members right now, then who has waited longest).
--
-- LOCAL layer, member-owned: a member volunteers or withdraws themselves (Big Sisters page);
-- staff can also add or remove a volunteer. A row with deleted_at NULL is a current volunteer;
-- withdrawing sets deleted_at and volunteering again clears it, so the history stays. Being a
-- volunteer doesn't gate being matched: staff can still match any member by hand.
--
-- Readable by the member and admins only (the pool isn't a public list). Writes: the member
-- their own row, admins any. Sudo is an app-layer cookie Postgres can't see
-- (current_member_id() is the admin's own member then), so in sudo the app shows it read-only.

CREATE TABLE big_sister_volunteers (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_big_sister_volunteers_current ON big_sister_volunteers (member_id) WHERE deleted_at IS NULL;

CREATE TRIGGER big_sister_volunteers_updated_at
  BEFORE UPDATE ON big_sister_volunteers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE big_sister_volunteers IS
  'LOCAL: members who volunteer to be a Big Sister (deleted_at NULL = currently volunteering). Readable by the member and admins; writable by the member (own row, read-only in sudo) and admins. Not reprocessed.';
COMMENT ON COLUMN big_sister_volunteers.note IS
  'Anything the volunteer wants staff to know when matching, e.g. "mornings ET". Admin-visible only.';

ALTER TABLE big_sister_volunteers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and admins read big_sister_volunteers" ON big_sister_volunteers
  FOR SELECT TO authenticated
  USING (member_id = (SELECT current_member_id()) OR (SELECT is_admin()));

CREATE POLICY "Members insert own big_sister_volunteers" ON big_sister_volunteers
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT current_member_id()));

CREATE POLICY "Members update own big_sister_volunteers" ON big_sister_volunteers
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT current_member_id()))
  WITH CHECK (member_id = (SELECT current_member_id()));

CREATE POLICY "Admins manage big_sister_volunteers" ON big_sister_volunteers
  FOR ALL TO authenticated
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON big_sister_volunteers
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('big_sister_volunteer', 'member_id');
