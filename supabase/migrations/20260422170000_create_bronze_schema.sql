-- Create bronze schema for raw import data
-- Bronze layer is hidden from Supabase API, accessed server-side only

CREATE SCHEMA IF NOT EXISTS bronze;

-- Grant permissions
GRANT USAGE ON SCHEMA bronze TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA bronze TO postgres, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA bronze TO anon, authenticated;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA bronze GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA bronze GRANT SELECT ON TABLES TO anon, authenticated;

COMMENT ON SCHEMA bronze IS 'Bronze Layer: Raw data from external systems (UPSERT by natural key, append-only or idempotent imports)';
