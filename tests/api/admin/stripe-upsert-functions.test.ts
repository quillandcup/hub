import { describe, it, expect } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * The upsert_stripe_* RPCs were dead code (the Stripe import upserts bronze.stripe_*
 * directly) and are dropped by 20260927000000_drop_unused_stripe_upsert_functions.sql.
 * Guard against them being recreated: they ran SECURITY DEFINER and were once callable
 * by anyone holding the anon key.
 */
describe('upsert_stripe_* functions', () => {
  const service = getTestSupabaseAdminClient()

  it.each(['upsert_stripe_customers', 'upsert_stripe_products', 'upsert_stripe_subscriptions'])(
    '%s no longer exists',
    async (fn) => {
      const { error } = await service.rpc(fn, { records: [] })
      expect(error?.code).toBe('PGRST202')
    }
  )
})
