import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/members stores members.total_active_months as the merged coverage of Kajabi stints,
 * program-cohort enrollments and gift / direct Stripe overrides, minus hiatus. Time no source
 * covers is not counted, time two sources cover counts once, and a reprocess writes the same value.
 */
describe('Total active months merges stints and program/gift coverage during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString()
  const daysAhead = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000).toISOString()
  const dateOnly = (iso: string) => iso.split('T')[0]

  const offerId = `months-offer-${ts}`
  const emailGap = `months-gap-${ts}@example.com`
  const emailDup = `months-dup-${ts}@example.com`
  let programId: string | null = null

  async function reprocess() {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    }
    return response.json()
  }

  async function fetchMember(email: string) {
    const { data } = await supabase.from('members').select('*').eq('email', email).single()
    return data
  }

  beforeAll(async () => {
    await supabase.schema('bronze').from('kajabi_offers').upsert([
      { kajabi_offer_id: offerId, name: 'Quill & Cup Membership', trial_period_days: 0, data: { attributes: { subscription: true } } },
    ], { onConflict: 'kajabi_offer_id' })
    await supabase.schema('bronze').from('kajabi_contacts').insert([
      { kajabi_contact_id: `months-contact-gap-${ts}`, email: emailGap, name: 'Months Gap', created_at_kajabi: daysAgo(900), data: {} },
      { kajabi_contact_id: `months-contact-dup-${ts}`, email: emailDup, name: 'Months Dup', created_at_kajabi: daysAgo(900), data: {} },
    ])
    await supabase.schema('bronze').from('kajabi_customers').insert([
      { kajabi_customer_id: `months-cust-gap-${ts}`, email: emailGap, data: {} },
      { kajabi_customer_id: `months-cust-dup-${ts}`, email: emailDup, data: {} },
    ])
    const purchase = (id: string, cust: string, start: number, end: number | null) => ({
      kajabi_purchase_id: `months-p-${id}-${ts}`,
      kajabi_customer_id: `months-cust-${cust}-${ts}`,
      kajabi_offer_id: offerId,
      status: end === null ? 'active' : 'inactive',
      created_at_kajabi: daysAgo(start),
      effective_start_at: daysAgo(start),
      deactivated_at: end === null ? null : daysAgo(end),
      data: {},
    })
    await supabase.schema('bronze').from('kajabi_purchases').insert([
      // Gap member: 200 days of membership ending 700 days ago.
      purchase('gap', 'gap', 900, 700),
      // Duplicate member: two ongoing subscriptions side by side, 600 days and 300 days old.
      purchase('dup-a', 'dup', 600, null),
      purchase('dup-b', 'dup', 300, null),
    ])
  })

  afterAll(async () => {
    if (programId) await supabase.from('programs').delete().eq('id', programId)
    await supabase.schema('bronze').from('kajabi_purchases').delete().ilike('kajabi_purchase_id', `months-p-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_customers').delete().ilike('kajabi_customer_id', `months-cust-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `months-contact-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_offers').delete().eq('kajabi_offer_id', offerId)
    await supabase.from('members').delete().in('email', [emailGap, emailDup])
  })

  it('counts overlapping stints once and only the stint before any program or gift', async () => {
    await reprocess()
    // 200 days of membership is 6 months; two overlapping subscriptions cover 600 days, not 900.
    expect((await fetchMember(emailGap))?.total_active_months).toBe(6)
    expect((await fetchMember(emailDup))?.total_active_months).toBe(20)
  })

  it('adds a gift that does not overlap the stint, identically on every reprocess', async () => {
    const gap = await fetchMember(emailGap)
    const { data: p, error } = await supabase
      .from('programs')
      .insert({ name: `Months Program ${ts}`, slug: `months-program-${ts}` })
      .select('id')
      .single()
    expect(error).toBeNull()
    programId = p!.id
    const { data: cohort } = await supabase
      .from('program_cohorts')
      .insert({ program_id: programId, name: `Months Cohort ${ts}`, starts_at: dateOnly(daysAgo(60)), expires_at: dateOnly(daysAhead(60)) })
      .select('id')
      .single()
    await supabase.from('member_program_enrollments').insert({ member_id: gap!.id, cohort_id: cohort!.id })

    await reprocess()
    // 200 days of membership plus 60 days of program (the cohort start is a date, up to a day off) = 260 days, 8 months.
    const first = await fetchMember(emailGap)
    expect(first?.total_active_months).toBe(8)

    await reprocess()
    const second = await fetchMember(emailGap)
    expect(second?.total_active_months).toBe(first?.total_active_months)
    expect(second?.id).toBe(first?.id)
  })
})
