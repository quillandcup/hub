import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from './helpers/supabase'
import { fetchMembershipHistory } from '@/lib/kajabi/membership-history'

describe('fetchMembershipHistory', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const testCustomerId = `mh-test-customer-${ts}`
  const subscriptionOfferId = `mh-test-offer-subscription-${ts}`
  const workshopOfferId = `mh-test-offer-workshop-${ts}`
  const retreatOfferId = `mh-test-offer-retreat-${ts}`
  const subscriptionPurchaseId = `mh-test-purchase-subscription-${ts}`
  const workshopPurchaseId = `mh-test-purchase-workshop-${ts}`
  const retreatPurchaseId = `mh-test-purchase-retreat-${ts}`

  async function cleanUp() {
    await supabase.schema('bronze').from('kajabi_purchases')
      .delete().in('kajabi_purchase_id', [subscriptionPurchaseId, workshopPurchaseId, retreatPurchaseId])
    await supabase.schema('bronze').from('kajabi_offers')
      .delete().in('kajabi_offer_id', [subscriptionOfferId, workshopOfferId, retreatOfferId])
    await supabase.schema('bronze').from('kajabi_customers')
      .delete().eq('kajabi_customer_id', testCustomerId)
  }

  beforeAll(async () => {
    await cleanUp()

    await supabase.schema('bronze').from('kajabi_customers').insert({
      kajabi_customer_id: testCustomerId,
      email: `mh-test-${ts}@example.com`,
      name: 'Membership History Test Member',
      data: {},
    })

    await supabase.schema('bronze').from('kajabi_offers').insert([
      {
        kajabi_offer_id: subscriptionOfferId,
        name: 'Quill & Cup Membership',
        status: 'published',
        data: { attributes: { subscription: true } },
      },
      {
        kajabi_offer_id: workshopOfferId,
        name: 'Mindset Training for Live Feedback Workshop',
        status: 'published',
        data: { attributes: { subscription: true } },
      },
      {
        kajabi_offer_id: retreatOfferId,
        name: 'Quill & Cup Retreat Deposit',
        status: 'published',
        data: { attributes: { subscription: false } },
      },
    ])

    await supabase.schema('bronze').from('kajabi_purchases').insert([
      {
        kajabi_purchase_id: subscriptionPurchaseId,
        kajabi_customer_id: testCustomerId,
        kajabi_offer_id: subscriptionOfferId,
        status: 'active',
        created_at_kajabi: '2024-01-01T00:00:00Z',
        deactivated_at: null,
        data: {},
      },
      {
        kajabi_purchase_id: workshopPurchaseId,
        kajabi_customer_id: testCustomerId,
        kajabi_offer_id: workshopOfferId,
        status: 'canceled',
        created_at_kajabi: '2025-02-21T00:00:00Z',
        deactivated_at: '2026-05-01T00:00:00Z',
        data: {},
      },
      {
        kajabi_purchase_id: retreatPurchaseId,
        kajabi_customer_id: testCustomerId,
        kajabi_offer_id: retreatOfferId,
        status: 'active',
        created_at_kajabi: '2023-10-20T00:00:00Z',
        deactivated_at: null,
        data: {},
      },
    ])
  })

  afterAll(cleanUp)

  it('includes membership subscription purchases', async () => {
    const history = await fetchMembershipHistory(supabase, [testCustomerId])
    const entry = history.find(p => p.kajabi_offer_id === subscriptionOfferId)
    expect(entry).toBeDefined()
    expect(entry!.created_at_kajabi).toBe('2024-01-01T00:00:00+00:00')
    expect(entry!.status).toBe('active')
  })

  it('excludes workshop offers even when subscription flag is true', async () => {
    const history = await fetchMembershipHistory(supabase, [testCustomerId])
    expect(history.find(p => p.kajabi_offer_id === workshopOfferId)).toBeUndefined()
  })

  it('excludes non-subscription offers (retreat deposits)', async () => {
    const history = await fetchMembershipHistory(supabase, [testCustomerId])
    expect(history.find(p => p.kajabi_offer_id === retreatOfferId)).toBeUndefined()
  })

  it('returns empty array for no customer IDs', async () => {
    const history = await fetchMembershipHistory(supabase, [])
    expect(history).toHaveLength(0)
  })

  it('returns empty array when customer has only non-membership purchases', async () => {
    const onlyRetreatCustomerId = `mh-retreat-only-${ts}`
    await supabase.schema('bronze').from('kajabi_customers').insert({
      kajabi_customer_id: onlyRetreatCustomerId,
      email: `mh-retreat-only-${ts}@example.com`,
      name: 'Retreat Only Member',
      data: {},
    })
    await supabase.schema('bronze').from('kajabi_purchases').insert({
      kajabi_purchase_id: `mh-retreat-only-purchase-${ts}`,
      kajabi_customer_id: onlyRetreatCustomerId,
      kajabi_offer_id: retreatOfferId,
      status: 'active',
      created_at_kajabi: '2023-09-12T00:00:00Z',
      deactivated_at: null,
      data: {},
    })

    try {
      const history = await fetchMembershipHistory(supabase, [onlyRetreatCustomerId])
      expect(history).toHaveLength(0)
    } finally {
      await supabase.schema('bronze').from('kajabi_purchases')
        .delete().eq('kajabi_purchase_id', `mh-retreat-only-purchase-${ts}`)
      await supabase.schema('bronze').from('kajabi_customers')
        .delete().eq('kajabi_customer_id', onlyRetreatCustomerId)
    }
  })
})
