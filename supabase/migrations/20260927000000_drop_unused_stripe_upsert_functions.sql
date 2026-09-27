-- Drop the unused upsert_stripe_* RPC functions (from 20260429000002).
--
-- Nothing calls them: the Stripe import (app/api/import/stripe/route.ts) upserts
-- straight into bronze.stripe_* via PostgREST. Production had already lost them
-- (the migration is recorded as applied there, but the functions don't exist), so
-- this brings local, CI and production back in line. IF EXISTS makes it a no-op on
-- production. 20260926001100 (which hardened them) stays as-is; it already skips
-- functions that don't exist.

DROP FUNCTION IF EXISTS public.upsert_stripe_customers(jsonb);
DROP FUNCTION IF EXISTS public.upsert_stripe_products(jsonb);
DROP FUNCTION IF EXISTS public.upsert_stripe_subscriptions(jsonb);
