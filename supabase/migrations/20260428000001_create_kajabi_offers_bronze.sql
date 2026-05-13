-- Create bronze.kajabi_offers table for storing raw offer data from Kajabi API
-- Part of Bronze layer (raw imports) - UPSERT pattern by kajabi_offer_id

CREATE TABLE IF NOT EXISTS bronze.kajabi_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kajabi_offer_id TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT,
  trial_period_days INTEGER,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

-- Index for lookups by kajabi_offer_id
CREATE INDEX IF NOT EXISTS idx_kajabi_offers_offer_id
  ON bronze.kajabi_offers(kajabi_offer_id);

-- Index for trial offers
CREATE INDEX IF NOT EXISTS idx_kajabi_offers_trial
  ON bronze.kajabi_offers(trial_period_days)
  WHERE trial_period_days > 0;

-- Grant permissions (Bronze layer: server-side writes only, but allow authenticated reads for testing)
GRANT SELECT ON bronze.kajabi_offers TO anon, authenticated;
GRANT ALL ON bronze.kajabi_offers TO postgres, service_role, authenticated;

COMMENT ON TABLE bronze.kajabi_offers IS 'BRONZE: Raw offer data from Kajabi API. UPSERT by kajabi_offer_id for idempotency.';
