-- Create Bronze tables for Stripe data
-- Following medallion architecture: Bronze = raw data from Stripe API

-- Subscriptions: Active, paused, past_due, canceled, etc.
CREATE TABLE IF NOT EXISTS bronze.stripe_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL, -- active, paused, past_due, canceled, incomplete, trialing, unpaid
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at_stripe TIMESTAMPTZ,
  pause_collection JSONB, -- {behavior, resumes_at}
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_subscription_id
  ON bronze.stripe_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_customer_id
  ON bronze.stripe_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_status
  ON bronze.stripe_subscriptions(status);

-- Customers: Email and metadata for matching to Kajabi
CREATE TABLE IF NOT EXISTS bronze.stripe_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  created_at_stripe TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_customers_customer_id
  ON bronze.stripe_customers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_email
  ON bronze.stripe_customers(email);

-- Products: For matching subscription items to product names
CREATE TABLE IF NOT EXISTS bronze.stripe_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_product_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_products_product_id
  ON bronze.stripe_products(stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_stripe_products_active
  ON bronze.stripe_products(active);

-- Grant permissions
GRANT SELECT ON bronze.stripe_subscriptions TO anon, authenticated;
GRANT ALL ON bronze.stripe_subscriptions TO postgres, service_role, authenticated;

GRANT SELECT ON bronze.stripe_customers TO anon, authenticated;
GRANT ALL ON bronze.stripe_customers TO postgres, service_role, authenticated;

GRANT SELECT ON bronze.stripe_products TO anon, authenticated;
GRANT ALL ON bronze.stripe_products TO postgres, service_role, authenticated;

-- Comments
COMMENT ON TABLE bronze.stripe_subscriptions IS 'BRONZE: Raw subscription data from Stripe API. UPSERT by stripe_subscription_id.';
COMMENT ON TABLE bronze.stripe_customers IS 'BRONZE: Raw customer data from Stripe API. UPSERT by stripe_customer_id.';
COMMENT ON TABLE bronze.stripe_products IS 'BRONZE: Raw product data from Stripe API. UPSERT by stripe_product_id.';
