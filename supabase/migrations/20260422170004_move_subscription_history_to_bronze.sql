-- Move subscription_history to bronze schema
ALTER TABLE IF EXISTS public.subscription_history SET SCHEMA bronze;

-- Update comment to match architecture
COMMENT ON TABLE bronze.subscription_history IS 'BRONZE: Raw subscription data from Kajabi exports (append-only snapshots by kajabi_subscription_id + imported_at)';
