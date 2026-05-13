-- Create proper Bronze tables for Kajabi API data
-- Following medallion architecture: Bronze = raw data, Silver = derived/canonical

-- Contacts: All people in Kajabi (leads, trials, members, former members)
CREATE TABLE IF NOT EXISTS bronze.kajabi_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kajabi_contact_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  created_at_kajabi TIMESTAMPTZ,
  updated_at_kajabi TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kajabi_contacts_contact_id
  ON bronze.kajabi_contacts(kajabi_contact_id);
CREATE INDEX IF NOT EXISTS idx_kajabi_contacts_email
  ON bronze.kajabi_contacts(email);

-- Customers: Subset of contacts who made at least one purchase
CREATE TABLE IF NOT EXISTS bronze.kajabi_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kajabi_customer_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  created_at_kajabi TIMESTAMPTZ,
  updated_at_kajabi TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kajabi_customers_customer_id
  ON bronze.kajabi_customers(kajabi_customer_id);
CREATE INDEX IF NOT EXISTS idx_kajabi_customers_email
  ON bronze.kajabi_customers(email);

-- Purchases: Subscription records (Kajabi stores subscriptions as "purchases")
CREATE TABLE IF NOT EXISTS bronze.kajabi_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kajabi_purchase_id TEXT NOT NULL UNIQUE,
  kajabi_customer_id TEXT,
  kajabi_offer_id TEXT,
  amount_in_cents INTEGER,
  currency TEXT,
  status TEXT, -- derived from deactivated_at (null = active)
  created_at_kajabi TIMESTAMPTZ,
  effective_start_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kajabi_purchases_purchase_id
  ON bronze.kajabi_purchases(kajabi_purchase_id);
CREATE INDEX IF NOT EXISTS idx_kajabi_purchases_customer_id
  ON bronze.kajabi_purchases(kajabi_customer_id);
CREATE INDEX IF NOT EXISTS idx_kajabi_purchases_offer_id
  ON bronze.kajabi_purchases(kajabi_offer_id);
CREATE INDEX IF NOT EXISTS idx_kajabi_purchases_status
  ON bronze.kajabi_purchases(status);

-- Grant permissions (Bronze layer: server-side writes, authenticated reads for processing)
GRANT SELECT ON bronze.kajabi_contacts TO anon, authenticated;
GRANT ALL ON bronze.kajabi_contacts TO postgres, service_role, authenticated;

GRANT SELECT ON bronze.kajabi_customers TO anon, authenticated;
GRANT ALL ON bronze.kajabi_customers TO postgres, service_role, authenticated;

GRANT SELECT ON bronze.kajabi_purchases TO anon, authenticated;
GRANT ALL ON bronze.kajabi_purchases TO postgres, service_role, authenticated;

-- Comments
COMMENT ON TABLE bronze.kajabi_contacts IS 'BRONZE: Raw contact data from Kajabi API /v1/contacts. UPSERT by kajabi_contact_id.';
COMMENT ON TABLE bronze.kajabi_customers IS 'BRONZE: Raw customer data from Kajabi API /v1/customers. UPSERT by kajabi_customer_id.';
COMMENT ON TABLE bronze.kajabi_purchases IS 'BRONZE: Raw purchase data from Kajabi API /v1/purchases. UPSERT by kajabi_purchase_id.';
