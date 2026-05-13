-- Deprecate bronze.subscription_history and hiatus processing
--
-- Rationale:
-- - Subscription data is already captured in bronze.kajabi_purchases (raw purchase data)
-- - Inferred hiatus detection never worked (0 detections in all runs)
-- - Hiatus will be intentionally managed via admin UI workflows (see hiatus-management.md spec)
-- - member_hiatus_history table remains for future manual hiatus tracking
--
-- This migration:
-- - Adds deprecation comments to subscription_history table
-- - Documents that /api/process/hiatus route is deprecated
-- - Preserves existing data for potential migration/analysis

COMMENT ON TABLE bronze.subscription_history IS 'DEPRECATED: Use bronze.kajabi_purchases instead. This table duplicated purchase data with transformation. Hiatus will be managed via admin workflows, not inferred from subscriptions.';

-- Note: We keep the table for now in case we need to reference historical data
-- but it will no longer be populated by imports
