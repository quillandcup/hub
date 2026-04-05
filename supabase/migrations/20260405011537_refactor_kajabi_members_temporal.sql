-- Refactor kajabi_members to temporal history table
-- Change from UPSERT (one row per email) to INSERT (multiple snapshots over time)

-- Drop existing table and recreate with new structure
DROP TABLE IF EXISTS kajabi_members CASCADE;

CREATE TABLE kajabi_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    data JSONB NOT NULL
);

-- Unique constraint to prevent duplicate imports at same timestamp
CREATE UNIQUE INDEX idx_kajabi_members_email_imported_at ON kajabi_members(email, imported_at);

-- Index for querying by email (to get history)
CREATE INDEX idx_kajabi_members_email ON kajabi_members(email);

-- Index for querying by import time (to get all members at a point in time)
CREATE INDEX idx_kajabi_members_imported_at ON kajabi_members(imported_at);

COMMENT ON TABLE kajabi_members IS 'Bronze: Temporal history of Kajabi member exports (preserves all import snapshots)';
COMMENT ON COLUMN kajabi_members.imported_at IS 'Timestamp when this snapshot was imported';
COMMENT ON COLUMN kajabi_members.data IS 'All columns from Kajabi CSV export stored as JSONB';
