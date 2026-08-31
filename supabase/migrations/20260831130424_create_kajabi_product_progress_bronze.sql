-- Create bronze.kajabi_product_progress table for storing Kajabi's manual
-- "Product Progress" export (course completion/engagement data).
-- Part of Bronze layer. Kajabi exposes no API for this data (Analytics ->
-- Product Progress -> Export Excel only), so rows are append-only snapshots
-- rather than UPSERT-by-natural-ID -- same pattern as subscription_history.

CREATE TABLE IF NOT EXISTS bronze.kajabi_product_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email TEXT NOT NULL,
  product_name TEXT NOT NULL,
  completion_percentage INTEGER,
  lessons_completed INTEGER,
  total_lessons INTEGER,
  last_activity_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL,
  UNIQUE (member_email, product_name, imported_at)
);

-- Index for lookups by member (e.g. admin member detail page)
CREATE INDEX IF NOT EXISTS idx_kajabi_product_progress_email
  ON bronze.kajabi_product_progress(member_email);

-- Index for finding the latest snapshot per import run
CREATE INDEX IF NOT EXISTS idx_kajabi_product_progress_imported_at
  ON bronze.kajabi_product_progress(imported_at);

-- Grant permissions (Bronze layer: server-side writes only, but allow authenticated reads for testing)
GRANT SELECT ON bronze.kajabi_product_progress TO anon, authenticated;
GRANT ALL ON bronze.kajabi_product_progress TO postgres, service_role, authenticated;

COMMENT ON TABLE bronze.kajabi_product_progress IS 'BRONZE: Raw course completion/engagement data from Kajabi''s manual Product Progress export. Append-only snapshots keyed by (member_email, product_name, imported_at), same pattern as subscription_history.';
