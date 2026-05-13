-- RPC functions to upsert Stripe data (workaround for PostgREST schema cache issues)

CREATE OR REPLACE FUNCTION upsert_stripe_customers(records jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec jsonb;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO bronze.stripe_customers (
      stripe_customer_id,
      email,
      name,
      created_at_stripe,
      imported_at,
      data
    ) VALUES (
      rec->>'stripe_customer_id',
      rec->>'email',
      rec->>'name',
      (rec->>'created_at_stripe')::timestamptz,
      (rec->>'imported_at')::timestamptz,
      rec->'data'
    )
    ON CONFLICT (stripe_customer_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      created_at_stripe = EXCLUDED.created_at_stripe,
      imported_at = EXCLUDED.imported_at,
      data = EXCLUDED.data,
      updated_at = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION upsert_stripe_products(records jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec jsonb;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO bronze.stripe_products (
      stripe_product_id,
      name,
      active,
      imported_at,
      data
    ) VALUES (
      rec->>'stripe_product_id',
      rec->>'name',
      (rec->>'active')::boolean,
      (rec->>'imported_at')::timestamptz,
      rec->'data'
    )
    ON CONFLICT (stripe_product_id) DO UPDATE SET
      name = EXCLUDED.name,
      active = EXCLUDED.active,
      imported_at = EXCLUDED.imported_at,
      data = EXCLUDED.data,
      updated_at = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION upsert_stripe_subscriptions(records jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec jsonb;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO bronze.stripe_subscriptions (
      stripe_subscription_id,
      stripe_customer_id,
      status,
      current_period_start,
      current_period_end,
      canceled_at,
      created_at_stripe,
      pause_collection,
      imported_at,
      data
    ) VALUES (
      rec->>'stripe_subscription_id',
      rec->>'stripe_customer_id',
      rec->>'status',
      (rec->>'current_period_start')::timestamptz,
      (rec->>'current_period_end')::timestamptz,
      (rec->>'canceled_at')::timestamptz,
      (rec->>'created_at_stripe')::timestamptz,
      rec->'pause_collection',
      (rec->>'imported_at')::timestamptz,
      rec->'data'
    )
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      canceled_at = EXCLUDED.canceled_at,
      created_at_stripe = EXCLUDED.created_at_stripe,
      pause_collection = EXCLUDED.pause_collection,
      imported_at = EXCLUDED.imported_at,
      data = EXCLUDED.data,
      updated_at = now();
  END LOOP;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION upsert_stripe_customers TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION upsert_stripe_products TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION upsert_stripe_subscriptions TO authenticated, service_role;
