-- Kajabi's "Product Progress" report (the admin's per-product Export CSV), imported by an admin at
-- /admin/data/import. One row per (Kajabi course, student email): how much of the whole product the
-- student has completed, not per lesson. See docs/COURSES.md, "Importing Kajabi per-lesson progress".
--
-- No name column on purpose: the report has one, but matching is by email only and the admin who
-- uploads a file already has it, so an unmatched row is shown back to them by email from the upload
-- itself. Keeping fewer personal fields keeps this table smaller to protect.
-- Admins read, only the service role writes (the import route checks the admin, then writes).
-- Natural key, so no generated id: (course_kajabi_id, email). Not exposed anywhere by id.

CREATE TABLE bronze.kajabi_product_progress (
  course_kajabi_id TEXT NOT NULL,
  -- Lowercased and trimmed; matched to members.email or an email alias.
  email TEXT NOT NULL,
  percent NUMERIC(5, 2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  logins INTEGER CHECK (logins IS NULL OR logins >= 0),
  -- Null when the report says "Not Started" or leaves it blank.
  started_on DATE,
  -- The report gives a date, not a time.
  last_activity_on DATE,
  -- Which upload last wrote this row (changed rows only; an identical re-import writes nothing).
  import_batch TEXT NOT NULL,
  source_file TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when a later upload for the course no longer lists the student.
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (course_kajabi_id, email),
  CHECK (email = lower(btrim(email)))
);

ALTER TABLE bronze.kajabi_product_progress ENABLE ROW LEVEL SECURITY;
-- Default privileges in this schema would otherwise hand the new table to anon and authenticated.
REVOKE ALL ON bronze.kajabi_product_progress FROM anon, authenticated;
GRANT SELECT ON bronze.kajabi_product_progress TO authenticated;
GRANT ALL ON bronze.kajabi_product_progress TO service_role;
CREATE POLICY "Admins can read kajabi_product_progress" ON bronze.kajabi_product_progress
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON TABLE bronze.kajabi_product_progress IS
  'Kajabi Product Progress report CSV: percent of a product completed per student email. Admin read, service role write.';
