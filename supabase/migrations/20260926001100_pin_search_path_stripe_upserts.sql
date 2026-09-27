-- Harden the upsert_stripe_* RPC functions from 20260429000002_add_stripe_upsert_functions.sql.
--
-- Advisor findings (local `supabase db advisors`, plus the grant check the CLI's lint set
-- doesn't cover):
--   * 0011 function_search_path_mutable on all three.
--   * They're SECURITY DEFINER (write bronze.stripe_* bypassing RLS) and executable by PUBLIC,
--     anon and authenticated, so anyone with the anon key could overwrite Stripe bronze data via
--     /rest/v1/rpc/upsert_stripe_*.
--
-- Fix without redefining the bodies:
--   * search_path = '' -- the bodies already schema-qualify every table (bronze.stripe_*) and
--     otherwise use only pg_catalog built-ins (jsonb_array_elements, now(), casts), which are
--     always resolved regardless of search_path.
--   * EXECUTE limited to service_role. Nothing in app/ or lib/ calls these RPCs (the Stripe
--     import upserts through PostgREST directly with the service role), so only server-side
--     service-role use remains possible.
--
-- Guarded with to_regprocedure(): production doesn't currently have these functions (checked
-- read-only on 2026-09-27), so the migration is a no-op wherever they don't exist.

DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.upsert_stripe_customers(jsonb)',
    'public.upsert_stripe_products(jsonb)',
    'public.upsert_stripe_subscriptions(jsonb)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = %L', fn, '');
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;
