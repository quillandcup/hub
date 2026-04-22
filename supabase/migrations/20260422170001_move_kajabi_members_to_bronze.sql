-- Move kajabi_members table to bronze schema
-- This is a Bronze layer table (raw Kajabi data with UPSERT by email)

ALTER TABLE IF EXISTS public.kajabi_members SET SCHEMA bronze;

-- Update comment to match architecture
COMMENT ON TABLE bronze.kajabi_members IS 'BRONZE: Raw Kajabi member data (UPSERT by email for idempotent imports)';
