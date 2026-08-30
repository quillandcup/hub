-- Member Join Date Overrides (Local Layer)
-- Corrects first_joined_at for members whose true join date predates what
-- Kajabi has any record of (e.g. members who were on Quill & Cup before the
-- 2022 migration to Kajabi — Kajabi only knows about their post-migration
-- purchase, not their real original join date). One-off, admin-entered via
-- direct SQL — no admin UI, since this only applies to a fixed historical
-- cohort from the platform migration, not an ongoing case.

CREATE TABLE IF NOT EXISTS member_join_date_overrides (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  first_joined_at DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE member_join_date_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read member join date overrides"
  ON member_join_date_overrides FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert member join date overrides"
  ON member_join_date_overrides FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update member join date overrides"
  ON member_join_date_overrides FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete member join date overrides"
  ON member_join_date_overrides FOR DELETE
  TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON member_join_date_overrides TO authenticated;
GRANT ALL ON member_join_date_overrides TO service_role;

COMMENT ON TABLE member_join_date_overrides IS 'LOCAL: One-off corrections to members.first_joined_at for members whose true join date predates Kajabi (e.g. pre-2022-migration members) — applied by /api/process/members on every reprocess so it survives Kajabi syncs.';
