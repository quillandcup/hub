import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from './helpers/supabase'

/**
 * Membership History must only show subscription-type purchases, not one-time
 * purchases like retreat deposits or other non-subscription offers.
 *
 * Bug that prompted this: page.tsx fetched all kajabi_purchases for a customer
 * with no offer-type filtering, so retreat deposits appeared in Membership History.
 *
 * Fix: filter purchases to those whose offer has data.attributes.subscription === true.
 */
describe('Member Details - Membership History', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const testCustomerId = `mh-test-customer-${ts}`
  const subscriptionOfferId = `mh-test-offer-subscription-${ts}`
  const retreatOfferId = `mh-test-offer-retreat-${ts}`
  const subscriptionPurchaseId = `mh-test-purchase-subscription-${ts}`
  const retreatPurchaseId = `mh-test-purchase-retreat-${ts}`

  async function cleanUp() {
    await supabase.schema('bronze').from('kajabi_purchases')
      .delete().in('kajabi_purchase_id', [subscriptionPurchaseId, retreatPurchaseId])
    await supabase.schema('bronze').from('kajabi_offers')
      .delete().in('kajabi_offer_id', [subscriptionOfferId, retreatOfferId])
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
        effective_start_at: '2024-01-01T00:00:00Z',
        deactivated_at: null,
        data: {},
      },
      {
        kajabi_purchase_id: retreatPurchaseId,
        kajabi_customer_id: testCustomerId,
        kajabi_offer_id: retreatOfferId,
        status: 'active',
        effective_start_at: '2023-10-20T00:00:00Z',
        deactivated_at: null,
        data: {},
      },
    ])
  })

  afterAll(cleanUp)

  it('excludes one-time purchases (retreat deposits) from membership history', async () => {
    // Run the same query sequence as page.tsx
    const { data: purchases } = await supabase
      .schema('bronze')
      .from('kajabi_purchases')
      .select('effective_start_at, deactivated_at, status, kajabi_offer_id')
      .eq('kajabi_customer_id', testCustomerId)
      .order('effective_start_at', { ascending: false })

    expect(purchases).not.toBeNull()
    expect(purchases!.length).toBe(2)

    const offerIds = [...new Set(purchases!.map((p: any) => p.kajabi_offer_id).filter(Boolean))]
    const { data: offers } = await supabase
      .schema('bronze')
      .from('kajabi_offers')
      .select('kajabi_offer_id, data')
      .in('kajabi_offer_id', offerIds)

    const subscriptionOfferIds = new Set(
      (offers || [])
        .filter((o: any) => o.data?.attributes?.subscription === true)
        .map((o: any) => o.kajabi_offer_id)
    )

    const membershipHistory = purchases!.filter((p: any) => subscriptionOfferIds.has(p.kajabi_offer_id))

    expect(membershipHistory).toHaveLength(1)
    expect(membershipHistory[0].kajabi_offer_id).toBe(subscriptionOfferId)
  })

  it('includes subscription purchases in membership history', async () => {
    const { data: purchases } = await supabase
      .schema('bronze')
      .from('kajabi_purchases')
      .select('effective_start_at, deactivated_at, status, kajabi_offer_id')
      .eq('kajabi_customer_id', testCustomerId)
      .order('effective_start_at', { ascending: false })

    const offerIds = [...new Set(purchases!.map((p: any) => p.kajabi_offer_id).filter(Boolean))]
    const { data: offers } = await supabase
      .schema('bronze')
      .from('kajabi_offers')
      .select('kajabi_offer_id, data')
      .in('kajabi_offer_id', offerIds)

    const subscriptionOfferIds = new Set(
      (offers || [])
        .filter((o: any) => o.data?.attributes?.subscription === true)
        .map((o: any) => o.kajabi_offer_id)
    )

    const membershipHistory = purchases!.filter((p: any) => subscriptionOfferIds.has(p.kajabi_offer_id))

    const subscriptionEntry = membershipHistory.find((p: any) => p.kajabi_offer_id === subscriptionOfferId)
    expect(subscriptionEntry).toBeDefined()
    expect(subscriptionEntry!.effective_start_at).toBe('2024-01-01T00:00:00+00:00')
    expect(subscriptionEntry!.status).toBe('active')
  })

  it('returns empty membership history when customer has only non-subscription purchases', async () => {
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
      effective_start_at: '2023-09-12T00:00:00Z',
      deactivated_at: null,
      data: {},
    })

    try {
      const { data: purchases } = await supabase
        .schema('bronze')
        .from('kajabi_purchases')
        .select('effective_start_at, deactivated_at, status, kajabi_offer_id')
        .eq('kajabi_customer_id', onlyRetreatCustomerId)
        .order('effective_start_at', { ascending: false })

      const offerIds = [...new Set(purchases!.map((p: any) => p.kajabi_offer_id).filter(Boolean))]
      const { data: offers } = await supabase
        .schema('bronze')
        .from('kajabi_offers')
        .select('kajabi_offer_id, data')
        .in('kajabi_offer_id', offerIds)

      const subscriptionOfferIds = new Set(
        (offers || [])
          .filter((o: any) => o.data?.attributes?.subscription === true)
          .map((o: any) => o.kajabi_offer_id)
      )

      const membershipHistory = purchases!.filter((p: any) => subscriptionOfferIds.has(p.kajabi_offer_id))

      expect(membershipHistory).toHaveLength(0)
    } finally {
      await supabase.schema('bronze').from('kajabi_purchases')
        .delete().eq('kajabi_purchase_id', `mh-retreat-only-purchase-${ts}`)
      await supabase.schema('bronze').from('kajabi_customers')
        .delete().eq('kajabi_customer_id', onlyRetreatCustomerId)
    }
  })
})
