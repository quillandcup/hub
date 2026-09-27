import { describe, it, expect, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * The upsert_stripe_* RPCs still work after 20260926001100_pin_search_path_stripe_upserts.sql
 * pinned search_path = '' (their bodies schema-qualify bronze.*), and only the service role can
 * call them now.
 */
describe('upsert_stripe_* functions', () => {
  const service = getTestSupabaseAdminClient()
  const ts = Date.now()
  const customerId = `cus_fn_test_${ts}`
  const productId = `prod_fn_test_${ts}`
  const subscriptionId = `sub_fn_test_${ts}`
  const importedAt = new Date().toISOString()

  afterAll(async () => {
    await service.schema('bronze').from('stripe_subscriptions').delete().eq('stripe_subscription_id', subscriptionId)
    await service.schema('bronze').from('stripe_products').delete().eq('stripe_product_id', productId)
    await service.schema('bronze').from('stripe_customers').delete().eq('stripe_customer_id', customerId)
  })

  it('upsert_stripe_customers inserts then updates via the service role', async () => {
    const record = (name: string) => ({
      stripe_customer_id: customerId,
      email: `fn-test-${ts}@example.com`,
      name,
      created_at_stripe: '2026-01-01T00:00:00Z',
      imported_at: importedAt,
      data: { id: customerId },
    })
    expect((await service.rpc('upsert_stripe_customers', { records: [record('First')] })).error).toBeNull()
    expect((await service.rpc('upsert_stripe_customers', { records: [record('Second')] })).error).toBeNull()
    const { data } = await service.schema('bronze').from('stripe_customers').select('name').eq('stripe_customer_id', customerId)
    expect(data).toEqual([{ name: 'Second' }])
  })

  it('upsert_stripe_products inserts then updates via the service role', async () => {
    const record = (active: boolean) => ({
      stripe_product_id: productId,
      name: 'Fn Test Product',
      active,
      imported_at: importedAt,
      data: { id: productId },
    })
    expect((await service.rpc('upsert_stripe_products', { records: [record(true)] })).error).toBeNull()
    expect((await service.rpc('upsert_stripe_products', { records: [record(false)] })).error).toBeNull()
    const { data } = await service.schema('bronze').from('stripe_products').select('active').eq('stripe_product_id', productId)
    expect(data).toEqual([{ active: false }])
  })

  it('upsert_stripe_subscriptions inserts then updates via the service role', async () => {
    const record = (status: string) => ({
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      status,
      current_period_start: '2026-01-01T00:00:00Z',
      current_period_end: '2026-02-01T00:00:00Z',
      canceled_at: null,
      created_at_stripe: '2026-01-01T00:00:00Z',
      pause_collection: null,
      imported_at: importedAt,
      data: { id: subscriptionId },
    })
    expect((await service.rpc('upsert_stripe_subscriptions', { records: [record('active')] })).error).toBeNull()
    expect((await service.rpc('upsert_stripe_subscriptions', { records: [record('canceled')] })).error).toBeNull()
    const { data } = await service
      .schema('bronze')
      .from('stripe_subscriptions')
      .select('status')
      .eq('stripe_subscription_id', subscriptionId)
    expect(data).toEqual([{ status: 'canceled' }])
  })

  it.each(['upsert_stripe_customers', 'upsert_stripe_products', 'upsert_stripe_subscriptions'])(
    'anon cannot call %s',
    async (fn) => {
      const { error } = await getTestSupabaseClient().rpc(fn, { records: [] })
      expect(error).not.toBeNull()
    }
  )
})
