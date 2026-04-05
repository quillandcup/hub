-- Add kajabi_members table for raw Kajabi export data
-- This separates raw import data from canonical member data

CREATE TABLE IF NOT EXISTS kajabi_members (
    email TEXT PRIMARY KEY,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    data JSONB NOT NULL, -- All columns from Kajabi CSV export
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kajabi_members_imported_at ON kajabi_members(imported_at);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_kajabi_members_updated_at ON kajabi_members;
CREATE TRIGGER update_kajabi_members_updated_at BEFORE UPDATE ON kajabi_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update comment on members table to clarify relationship
COMMENT ON TABLE kajabi_members IS 'Bronze: Raw Kajabi member export data (preserves all import history)';
COMMENT ON TABLE members IS 'Bronze: Canonical member data (derived from kajabi_members with business logic)';
