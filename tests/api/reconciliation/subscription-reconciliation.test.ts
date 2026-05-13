import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * Integration tests for GET /api/analyze/subscription-reconciliation
 *
 * Tests the key business logic:
 * 1. Kajabi matching by email (not stale kajabi_id)
 * 2. Stripe subscription filtered to membership products only
 * 3. Gift override makes paused Stripe → expected=active
 * 4. Paused Stripe with no override → expected=inactive
 * 5. Discrepancy detection: paying Stripe + inactive Kajabi
 * 6. Discrepancy detection: expected active + inactive Kajabi
 */
describe('Subscription Reconciliation', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  // Unique IDs for all test data to avoid collisions
  const ids = {
    membershipOfferId: `test-offer-membership-${ts}`,
    retreatOfferId: `test-offer-retreat-${ts}`,
    membershipProductId: `prod_test_membership_${ts}`,
    retreatProductId: `prod_test_retreat_${ts}`,
    membershipStripeCustomerId: `cus_test_membership_${ts}`,
    retreatStripeCustomerId: `cus_test_retreat_${ts}`,
    pausedGiftCustomerId: `cus_test_paused_gift_${ts}`,
    pausedNoOverrideCustomerId: `cus_test_paused_no_override_${ts}`,
    staleKajabiCustomerId: `cus_test_stale_kajabi_${ts}`,
    discrepancyCustomerId: `cus_test_discrepancy_${ts}`,
  }

  const emails = {
    payingActive: `recon-paying-active-${ts}@example.com`,
    pausedGift: `recon-paused-gift-${ts}@example.com`,
    pausedNoOverride: `recon-paused-no-override-${ts}@example.com`,
    retreatOnly: `recon-retreat-only-${ts}@example.com`,
    staleKajabiId: `recon-stale-kajabi-${ts}@example.com`,
    payingInactiveKajabi: `recon-paying-inactive-${ts}@example.com`,
  }

  const kajabi = {
    payingCustomerId: `kjb_cust_paying_${ts}`,
    pausedGiftCustomerId: `kjb_cust_paused_gift_${ts}`,
    pausedNoOverrideCustomerId: `kjb_cust_paused_no_override_${ts}`,
    staleKajabiCustomerId: `kjb_cust_stale_${ts}`,
    freshKajabiCustomerId: `kjb_cust_fresh_${ts}`,
  }

  let memberIds: Record<string, string> = {}
  let overrideId: string

  beforeAll(async () => {
    // -- Kajabi offers --
    await supabase.schema('bronze').from('kajabi_offers').upsert([
      {
        kajabi_offer_id: ids.membershipOfferId,
        name: 'Quill & Cup Membership',
        status: 'active',
        data: {},
      },
      {
        kajabi_offer_id: ids.retreatOfferId,
        name: 'Writerly Retreat Tickets',
        status: 'active',
        data: {},
      },
    ], { onConflict: 'kajabi_offer_id' })

    // -- Stripe products --
    await supabase.schema('bronze').from('stripe_products').upsert([
      {
        stripe_product_id: ids.membershipProductId,
        name: 'Quill & Cup Membership',
        active: true,
        data: {},
      },
      {
        stripe_product_id: ids.retreatProductId,
        name: 'Writerly Retreat',
        active: true,
        data: {},
      },
    ], { onConflict: 'stripe_product_id' })

    // -- Members (Silver layer) --
    const { data: members } = await supabase.from('members').insert([
      { name: 'Paying Active Member', email: emails.payingActive, joined_at: '2023-01-01', status: 'active' },
      { name: 'Paused Gift Member', email: emails.pausedGift, joined_at: '2023-01-01', status: 'active' },
      { name: 'Paused No Override', email: emails.pausedNoOverride, joined_at: '2023-01-01', status: 'active' },
      { name: 'Retreat Only Member', email: emails.retreatOnly, joined_at: '2023-01-01', status: 'active' },
      { name: 'Stale Kajabi ID Member', email: emails.staleKajabiId, joined_at: '2023-01-01', status: 'active', kajabi_id: 'stale-wrong-id' },
      { name: 'Paying Inactive Kajabi', email: emails.payingInactiveKajabi, joined_at: '2023-01-01', status: 'active' },
    ]).select('id, email')

    members?.forEach(m => { memberIds[m.email] = m.id })

    // -- Kajabi customers (matched by email) --
    await supabase.schema('bronze').from('kajabi_customers').insert([
      { kajabi_customer_id: kajabi.payingCustomerId, email: emails.payingActive, data: {} },
      { kajabi_customer_id: kajabi.pausedGiftCustomerId, email: emails.pausedGift, data: {} },
      { kajabi_customer_id: kajabi.pausedNoOverrideCustomerId, email: emails.pausedNoOverride, data: {} },
      // staleKajabiCustomerId has the CORRECT email but different ID than member.kajabi_id
      { kajabi_customer_id: kajabi.freshKajabiCustomerId, email: emails.staleKajabiId, data: {} },
    ])

    // -- Kajabi purchases (active membership) --
    await supabase.schema('bronze').from('kajabi_purchases').insert([
      {
        kajabi_purchase_id: `kjb_purchase_paying_${ts}`,
        kajabi_customer_id: kajabi.payingCustomerId,
        kajabi_offer_id: ids.membershipOfferId,
        deactivated_at: null,
        data: {},
      },
      {
        kajabi_purchase_id: `kjb_purchase_paused_gift_${ts}`,
        kajabi_customer_id: kajabi.pausedGiftCustomerId,
        kajabi_offer_id: ids.membershipOfferId,
        deactivated_at: null,
        data: {},
      },
      {
        kajabi_purchase_id: `kjb_purchase_paused_no_override_${ts}`,
        kajabi_customer_id: kajabi.pausedNoOverrideCustomerId,
        kajabi_offer_id: ids.membershipOfferId,
        deactivated_at: null,
        data: {},
      },
      {
        // stale kajabi_id member is matched via email, not the stale kajabi_id
        kajabi_purchase_id: `kjb_purchase_stale_kajabi_${ts}`,
        kajabi_customer_id: kajabi.freshKajabiCustomerId,
        kajabi_offer_id: ids.membershipOfferId,
        deactivated_at: null,
        data: {},
      },
    ])

    // -- Stripe customers --
    await supabase.schema('bronze').from('stripe_customers').upsert([
      { stripe_customer_id: ids.membershipStripeCustomerId, email: emails.payingActive, data: {} },
      { stripe_customer_id: ids.retreatStripeCustomerId, email: emails.retreatOnly, data: {} },
      { stripe_customer_id: ids.pausedGiftCustomerId, email: emails.pausedGift, data: {} },
      { stripe_customer_id: ids.pausedNoOverrideCustomerId, email: emails.pausedNoOverride, data: {} },
      { stripe_customer_id: ids.discrepancyCustomerId, email: emails.payingInactiveKajabi, data: {} },
    ], { onConflict: 'stripe_customer_id' })

    const stripeItemFor = (productId: string) => ({
      items: { data: [{ price: { product: productId } }] },
    })

    // -- Stripe subscriptions --
    await supabase.schema('bronze').from('stripe_subscriptions').upsert([
      {
        stripe_subscription_id: `sub_paying_${ts}`,
        stripe_customer_id: ids.membershipStripeCustomerId,
        status: 'active',
        pause_collection: null,
        data: stripeItemFor(ids.membershipProductId),
      },
      {
        // Retreat subscription — should be excluded from membership reconciliation
        stripe_subscription_id: `sub_retreat_${ts}`,
        stripe_customer_id: ids.retreatStripeCustomerId,
        status: 'active',
        pause_collection: null,
        data: stripeItemFor(ids.retreatProductId),
      },
      {
        stripe_subscription_id: `sub_paused_gift_${ts}`,
        stripe_customer_id: ids.pausedGiftCustomerId,
        status: 'active',
        pause_collection: { behavior: 'void' },
        data: stripeItemFor(ids.membershipProductId),
      },
      {
        stripe_subscription_id: `sub_paused_no_override_${ts}`,
        stripe_customer_id: ids.pausedNoOverrideCustomerId,
        status: 'active',
        pause_collection: { behavior: 'void' },
        data: stripeItemFor(ids.membershipProductId),
      },
      {
        // Paying in Stripe but no Kajabi purchase → discrepancy
        stripe_subscription_id: `sub_discrepancy_${ts}`,
        stripe_customer_id: ids.discrepancyCustomerId,
        status: 'active',
        pause_collection: null,
        data: stripeItemFor(ids.membershipProductId),
      },
    ], { onConflict: 'stripe_subscription_id' })

    // -- Gift override for the paused member --
    const { data: override } = await supabase
      .from('member_status_overrides')
      .insert({
        member_id: memberIds[emails.pausedGift],
        override_type: 'gift',
        reason: '180 program',
        notes: 'Test override',
      })
      .select('id')
      .single()

    overrideId = override!.id
  })

  afterAll(async () => {
    // Clean up overrides
    await supabase.from('member_status_overrides').delete().eq('id', overrideId)

    // Clean up members (cascades to overrides)
    await supabase.from('members').delete().ilike('email', `recon-%-${ts}@example.com`)

    // Clean up Bronze data
    await supabase.schema('bronze').from('kajabi_purchases')
      .delete().ilike('kajabi_purchase_id', `kjb_purchase_%_${ts}`)
    await supabase.schema('bronze').from('kajabi_customers')
      .delete().ilike('kajabi_customer_id', `kjb_cust_%_${ts}`)
    await supabase.schema('bronze').from('kajabi_offers')
      .delete().in('kajabi_offer_id', [ids.membershipOfferId, ids.retreatOfferId])
    await supabase.schema('bronze').from('stripe_subscriptions')
      .delete().ilike('stripe_subscription_id', `sub_%_${ts}`)
    await supabase.schema('bronze').from('stripe_customers')
      .delete().in('stripe_customer_id', Object.values(ids).filter(id => id.startsWith('cus_')))
    await supabase.schema('bronze').from('stripe_products')
      .delete().in('stripe_product_id', [ids.membershipProductId, ids.retreatProductId])
  })

  async function fetchReconciliation() {
    const response = await fetch(
      'http://localhost:3000/api/analyze/subscription-reconciliation',
      { headers: getTestAuthHeaders() }
    )
    const body = await response.json()
    expect(response.ok, `API returned ${response.status}: ${JSON.stringify(body)}`).toBe(true)
    return body.members as any[]
  }

  function findMember(members: any[], email: string) {
    return members.find(m => m.member_email === email)
  }

  it('reports paying Stripe + active Kajabi as expected=active with no discrepancy', async () => {
    const members = await fetchReconciliation()
    const member = findMember(members, emails.payingActive)

    expect(member, 'paying active member not found in results').toBeTruthy()
    expect(member.stripe_state).toBe('paying')
    expect(member.actual_kajabi_state).toBe('active')
    expect(member.expected_kajabi_state).toBe('active')
    expect(member.has_discrepancy).toBe(false)
  })

  it('reports paused Stripe + gift override as expected=active', async () => {
    const members = await fetchReconciliation()
    const member = findMember(members, emails.pausedGift)

    expect(member, 'paused gift member not found in results').toBeTruthy()
    expect(member.stripe_state).toBe('paused')
    expect(member.override_type).toBe('gift')
    expect(member.expected_kajabi_state).toBe('active')
    // Kajabi is active, so no discrepancy
    expect(member.actual_kajabi_state).toBe('active')
    expect(member.has_discrepancy).toBe(false)
  })

  it('reports paused Stripe with no override as expected=inactive', async () => {
    const members = await fetchReconciliation()
    const member = findMember(members, emails.pausedNoOverride)

    expect(member, 'paused no-override member not found in results').toBeTruthy()
    expect(member.stripe_state).toBe('paused')
    expect(member.override_type).toBeNull()
    expect(member.expected_kajabi_state).toBe('inactive')
    // Kajabi is active but expected inactive → discrepancy
    expect(member.actual_kajabi_state).toBe('active')
    expect(member.has_discrepancy).toBe(true)
  })

  it('excludes non-membership Stripe subscriptions (retreat payment plans)', async () => {
    const members = await fetchReconciliation()
    const member = findMember(members, emails.retreatOnly)

    // Retreat-only member has no membership data → not in results at all
    expect(member).toBeUndefined()
  })

  it('matches Kajabi by email even when member.kajabi_id is stale', async () => {
    const members = await fetchReconciliation()
    const member = findMember(members, emails.staleKajabiId)

    expect(member, 'stale kajabi_id member not found in results').toBeTruthy()
    // Should have found the Kajabi purchase via email matching (not stale kajabi_id)
    expect(member.actual_kajabi_state).toBe('active')
  })

  it('reports discrepancy when paying in Stripe but inactive in Kajabi', async () => {
    const members = await fetchReconciliation()
    const member = findMember(members, emails.payingInactiveKajabi)

    expect(member, 'paying inactive kajabi member not found in results').toBeTruthy()
    expect(member.stripe_state).toBe('paying')
    expect(member.expected_kajabi_state).toBe('active')
    expect(member.actual_kajabi_state).toBe('inactive')
    expect(member.has_discrepancy).toBe(true)
  })

  it('includes override count in summary', async () => {
    const response = await fetch(
      'http://localhost:3000/api/analyze/subscription-reconciliation',
      { headers: getTestAuthHeaders() }
    )
    const body = await response.json()

    // Summary should reflect at least the 1 override we created
    expect(body.summary.total_overrides).toBeGreaterThanOrEqual(1)
  })
})
