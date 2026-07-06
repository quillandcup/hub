import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for GET /api/analyze/stripe-orphans
 *
 * An "orphan" is an active Stripe membership subscription with no matching
 * member record (matched by kajabi_id metadata or email, including aliases).
 */
describe('Stripe Orphans', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const base = getTestApiBaseUrl()

  const productId = `prod_orphan_membership_${ts}`
  const memberEmail = `orphan-member-${ts}@example.com`
  const orphanEmail = `orphan-stranger-${ts}@example.com`
  const aliasEmail = `orphan-alias-${ts}@example.com`
  const cancelledEmail = `orphan-cancelled-${ts}@example.com`
  const nonMembershipEmail = `orphan-retreat-${ts}@example.com`

  const ids = {
    memberCustomerId: `cus_orphan_member_${ts}`,
    orphanCustomerId: `cus_orphan_stranger_${ts}`,
    aliasCustomerId: `cus_orphan_alias_${ts}`,
    cancelledCustomerId: `cus_orphan_cancelled_${ts}`,
    nonMembershipCustomerId: `cus_orphan_retreat_${ts}`,
    retreatProductId: `prod_orphan_retreat_${ts}`,
    memberSubId: `sub_orphan_member_${ts}`,
    orphanSubId: `sub_orphan_stranger_${ts}`,
    aliasSubId: `sub_orphan_alias_${ts}`,
    cancelledSubId: `sub_orphan_cancelled_${ts}`,
    nonMembershipSubId: `sub_orphan_retreat_${ts}`,
  }

  let memberId: string
  let memberAliasId: string

  const mkSub = (id: string, customerId: string, status: string) => ({
    stripe_subscription_id: id,
    stripe_customer_id: customerId,
    status,
    data: { items: { data: [{ price: { product: productId } }] } },
  })

  beforeAll(async () => {
    // Membership Stripe product
    await supabase.schema('bronze').from('stripe_products').upsert([
      { stripe_product_id: productId, name: 'Quill & Cup Membership', active: true, data: {} },
      { stripe_product_id: ids.retreatProductId, name: 'Writerly Retreat', active: true, data: {} },
    ], { onConflict: 'stripe_product_id' })

    // Stripe customers
    await supabase.schema('bronze').from('stripe_customers').insert([
      { stripe_customer_id: ids.memberCustomerId, email: memberEmail, data: {} },
      { stripe_customer_id: ids.orphanCustomerId, email: orphanEmail, data: {} },
      { stripe_customer_id: ids.aliasCustomerId, email: aliasEmail, data: {} },
      { stripe_customer_id: ids.cancelledCustomerId, email: cancelledEmail, data: {} },
      { stripe_customer_id: ids.nonMembershipCustomerId, email: nonMembershipEmail, data: {} },
    ])

    // Active membership subscriptions
    await supabase.schema('bronze').from('stripe_subscriptions').insert([
      mkSub(ids.memberSubId, ids.memberCustomerId, 'active'),
      mkSub(ids.orphanSubId, ids.orphanCustomerId, 'active'),
      mkSub(ids.aliasSubId, ids.aliasCustomerId, 'active'),
      { ...mkSub(ids.cancelledSubId, ids.cancelledCustomerId, 'canceled') },
      // Non-membership sub (different product)
      {
        stripe_subscription_id: ids.nonMembershipSubId,
        stripe_customer_id: ids.nonMembershipCustomerId,
        status: 'active',
        data: { items: { data: [{ price: { product: ids.retreatProductId } }] } },
      },
    ])

    // One member who has a subscription (should NOT appear as orphan)
    const { data: m } = await supabase.from('members').insert({
      name: 'Orphan Test Member',
      email: memberEmail,
      joined_at: new Date().toISOString(),
      status: 'active',
    }).select('id').single()
    memberId = m!.id

    // Another member whose alias email matches the aliasCustomerId (should NOT appear as orphan)
    const { data: m2 } = await supabase.from('members').insert({
      name: 'Orphan Alias Member',
      email: `orphan-alias-canonical-${ts}@example.com`,
      joined_at: new Date().toISOString(),
      status: 'active',
    }).select('id').single()
    memberAliasId = m2!.id

    await supabase.from('member_email_aliases').insert({
      canonical_email: `orphan-alias-canonical-${ts}@example.com`,
      alias_email: aliasEmail,
      source: 'manual',
    })
  })

  afterAll(async () => {
    await supabase.from('member_email_aliases').delete().eq('alias_email', aliasEmail)
    await supabase.from('members').delete().in('id', [memberId, memberAliasId])
    await supabase.schema('bronze').from('stripe_subscriptions')
      .delete().in('stripe_subscription_id', Object.values(ids).filter(id => id.startsWith('sub_')))
    await supabase.schema('bronze').from('stripe_customers')
      .delete().in('stripe_customer_id', Object.values(ids).filter(id => id.startsWith('cus_')))
    await supabase.schema('bronze').from('stripe_products')
      .delete().in('stripe_product_id', [productId, ids.retreatProductId])
  })

  async function fetchOrphans() {
    const response = await fetch(`${base}/api/analyze/stripe-orphans`, { headers: getTestAuthHeaders() })
    const body = await response.json()
    expect(response.ok, `API returned ${response.status}: ${JSON.stringify(body)}`).toBe(true)
    return body as { total_active_subscriptions: number; orphans: any[] }
  }

  it('excludes members matched by email from orphans', async () => {
    const { orphans } = await fetchOrphans()
    expect(orphans.some((o: any) => o.email === memberEmail)).toBe(false)
  })

  it('excludes members matched by alias email from orphans', async () => {
    const { orphans } = await fetchOrphans()
    expect(orphans.some((o: any) => o.email === aliasEmail)).toBe(false)
  })

  it('includes active subscriptions with no member match as orphans', async () => {
    const { orphans } = await fetchOrphans()
    expect(orphans.some((o: any) => o.email === orphanEmail)).toBe(true)
  })

  it('excludes cancelled subscriptions', async () => {
    const { orphans } = await fetchOrphans()
    expect(orphans.some((o: any) => o.email === cancelledEmail)).toBe(false)
  })

  it('excludes non-membership subscriptions', async () => {
    const { orphans } = await fetchOrphans()
    expect(orphans.some((o: any) => o.email === nonMembershipEmail)).toBe(false)
  })
})
