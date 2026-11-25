import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/members stores members.inactive_periods: the dated stretches with no active coverage.
 * Coverage is Kajabi stints plus program-cohort enrollments plus gift / direct Stripe overrides
 * (the same notion of "active" as the admin membership timeline), so a gap before a program or a
 * gift is found even though no later Kajabi stint closes it. Reprocessing writes the same value.
 */
describe('Inactive periods count program cohorts and gifts as active during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString()
  const daysAhead = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000).toISOString()
  const dateOnly = (iso: string) => iso.split('T')[0]

  const membershipOfferId = `gaps-offer-${ts}`
  const emailProgram = `gaps-program-${ts}@example.com`
  const emailGift = `gaps-gift-${ts}@example.com`
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
      { kajabi_offer_id: membershipOfferId, name: 'Quill & Cup Membership', trial_period_days: 0, data: { attributes: { subscription: true } } },
    ], { onConflict: 'kajabi_offer_id' })
    await supabase.schema('bronze').from('kajabi_contacts').insert([
      { kajabi_contact_id: `gaps-contact-program-${ts}`, email: emailProgram, name: 'Gaps Program', created_at_kajabi: daysAgo(900), data: {} },
      { kajabi_contact_id: `gaps-contact-gift-${ts}`, email: emailGift, name: 'Gaps Gift', created_at_kajabi: daysAgo(900), data: {} },
    ])
    await supabase.schema('bronze').from('kajabi_customers').insert([
      { kajabi_customer_id: `gaps-cust-program-${ts}`, email: emailProgram, data: {} },
      { kajabi_customer_id: `gaps-cust-gift-${ts}`, email: emailGift, data: {} },
    ])
    // Each member's only Kajabi stint ended ~700 days ago, so no later stint ever closes the gap.
    await supabase.schema('bronze').from('kajabi_purchases').insert(
      ['program', 'gift'].map((who) => ({
        kajabi_purchase_id: `gaps-p-${who}-${ts}`,
        kajabi_customer_id: `gaps-cust-${who}-${ts}`,
        kajabi_offer_id: membershipOfferId,
        status: 'inactive',
        created_at_kajabi: daysAgo(900),
        effective_start_at: daysAgo(900),
        deactivated_at: daysAgo(700),
        data: {},
      }))
    )
  })

  afterAll(async () => {
    if (programId) await supabase.from('programs').delete().eq('id', programId)
    await supabase.schema('bronze').from('kajabi_purchases').delete().ilike('kajabi_purchase_id', `gaps-p-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_customers').delete().ilike('kajabi_customer_id', `gaps-cust-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `gaps-contact-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_offers').delete().eq('kajabi_offer_id', membershipOfferId)
    await supabase.from('members').delete().in('email', [emailProgram, emailGift])
  })

  it('has no gap while nothing covers the member after the stint (no trailing gap)', async () => {
    await reprocess()
    expect((await fetchMember(emailProgram))?.inactive_periods).toEqual([])
    expect((await fetchMember(emailGift))?.inactive_periods).toEqual([])
  })

  it('stores the gap before a program cohort enrollment and before a gift, identically on every reprocess', async () => {
    const program = await fetchMember(emailProgram)
    const gift = await fetchMember(emailGift)

    const { data: p, error: pErr } = await supabase
      .from('programs')
      .insert({ name: `Gaps Program ${ts}`, slug: `gaps-program-${ts}` })
      .select('id')
      .single()
    expect(pErr).toBeNull()
    programId = p!.id
    const { data: cohort } = await supabase
      .from('program_cohorts')
      .insert({ program_id: programId, name: `Gaps Cohort ${ts}`, starts_at: dateOnly(daysAgo(100)), expires_at: dateOnly(daysAhead(100)) })
      .select('id')
      .single()
    await supabase.from('member_program_enrollments').insert({ member_id: program!.id, cohort_id: cohort!.id })
    await supabase.from('member_status_overrides').insert({
      member_id: gift!.id,
      override_type: 'gift',
      reason: 'gaps test',
      starts_at: daysAgo(50),
      expires_at: daysAhead(50),
    })

    await reprocess()
    const firstProgram = await fetchMember(emailProgram)
    const firstGift = await fetchMember(emailGift)
    expect(firstProgram?.inactive_periods).toEqual([{ start: dateOnly(daysAgo(700)), end: dateOnly(daysAgo(100)) }])
    expect(firstGift?.inactive_periods).toEqual([{ start: dateOnly(daysAgo(700)), end: dateOnly(daysAgo(50)) }])

    await reprocess()
    expect((await fetchMember(emailProgram))?.inactive_periods).toEqual(firstProgram?.inactive_periods)
    expect((await fetchMember(emailGift))?.inactive_periods).toEqual(firstGift?.inactive_periods)
    expect((await fetchMember(emailProgram))?.id).toBe(firstProgram?.id)
  })
})
