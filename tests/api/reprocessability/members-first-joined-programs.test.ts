import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/members stores members.first_joined_at and most_recent_joined_at. Program-cohort
 * enrollments (and gift / direct Stripe overrides) count as being a member, so:
 * - a cohort that hands off to a membership the next day makes the cohort start the first-joined date
 *   (and the most recent: a handoff is not a return);
 * - a program after a long lapse in membership is the most recent join.
 * Reprocessing writes the same values. Dates are fixed, nothing depends on the clock.
 */
describe('First and most recent joined count program cohorts during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const membershipOfferId = `fj-offer-${ts}`
  const emailHandoff = `fj-handoff-${ts}@example.com`
  const emailReturn = `fj-return-${ts}@example.com`
  const emailOverride = `fj-override-${ts}@example.com`
  const emails = [emailHandoff, emailReturn, emailOverride]
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

  const purchase = (who: string, created: string, deactivated: string | null) => ({
    kajabi_purchase_id: `fj-p-${who}-${ts}`,
    kajabi_customer_id: `fj-cust-${who}-${ts}`,
    kajabi_offer_id: membershipOfferId,
    status: deactivated ? 'inactive' : 'active',
    created_at_kajabi: created,
    effective_start_at: created,
    deactivated_at: deactivated,
    data: {},
  })

  beforeAll(async () => {
    await supabase.schema('bronze').from('kajabi_offers').upsert([
      { kajabi_offer_id: membershipOfferId, name: 'Quill & Cup Membership', trial_period_days: 0, data: { attributes: { subscription: true } } },
    ], { onConflict: 'kajabi_offer_id' })
    await supabase.schema('bronze').from('kajabi_contacts').insert([
      { kajabi_contact_id: `fj-contact-handoff-${ts}`, email: emailHandoff, name: 'First Handoff', created_at_kajabi: '2026-07-16T10:00:00Z', data: {} },
      { kajabi_contact_id: `fj-contact-return-${ts}`, email: emailReturn, name: 'First Return', created_at_kajabi: '2023-04-18T10:00:00Z', data: {} },
      { kajabi_contact_id: `fj-contact-override-${ts}`, email: emailOverride, name: 'First Override', created_at_kajabi: '2026-07-16T10:00:00Z', data: {} },
    ])
    await supabase.schema('bronze').from('kajabi_customers').insert(
      ['handoff', 'return', 'override'].map((who) => ({ kajabi_customer_id: `fj-cust-${who}-${ts}`, email: `fj-${who}-${ts}@example.com`, data: {} }))
    )
    await supabase.schema('bronze').from('kajabi_purchases').insert([
      purchase('handoff', '2026-07-16T10:00:00Z', null),
      purchase('return', '2023-04-18T10:00:00Z', '2023-09-18T10:00:00Z'),
      purchase('override', '2026-07-16T10:00:00Z', null),
    ])
  })

  afterAll(async () => {
    if (programId) await supabase.from('programs').delete().eq('id', programId)
    await supabase.schema('bronze').from('kajabi_purchases').delete().ilike('kajabi_purchase_id', `fj-p-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_customers').delete().ilike('kajabi_customer_id', `fj-cust-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `fj-contact-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_offers').delete().eq('kajabi_offer_id', membershipOfferId)
    const { data: rows } = await supabase.from('members').select('id').in('email', emails)
    const ids = (rows ?? []).map((r) => r.id)
    if (ids.length > 0) await supabase.from('member_join_date_overrides').delete().in('member_id', ids)
    await supabase.from('members').delete().in('email', emails)
  })

  it('starts from the Kajabi dates alone before any program exists', async () => {
    await reprocess()
    expect((await fetchMember(emailHandoff))?.first_joined_at).toBe('2026-07-16')
    expect((await fetchMember(emailReturn))?.most_recent_joined_at).toBe('2023-04-18')
  })

  it('counts the program for first-joined and for a return, identically on every reprocess', async () => {
    const handoff = await fetchMember(emailHandoff)
    const returned = await fetchMember(emailReturn)
    const overridden = await fetchMember(emailOverride)

    const { data: p, error: pErr } = await supabase
      .from('programs')
      .insert({ name: `First Joined Program ${ts}`, slug: `fj-program-${ts}` })
      .select('id')
      .single()
    expect(pErr).toBeNull()
    programId = p!.id
    const { data: handoffCohort } = await supabase
      .from('program_cohorts')
      .insert({ program_id: programId, name: `FJ Handoff ${ts}`, starts_at: '2026-01-18', expires_at: '2026-07-15' })
      .select('id')
      .single()
    const { data: returnCohort } = await supabase
      .from('program_cohorts')
      .insert({ program_id: programId, name: `FJ Return ${ts}`, starts_at: '2026-06-14', expires_at: '2027-06-14' })
      .select('id')
      .single()
    await supabase.from('member_program_enrollments').insert([
      { member_id: handoff!.id, cohort_id: handoffCohort!.id },
      { member_id: overridden!.id, cohort_id: handoffCohort!.id },
      { member_id: returned!.id, cohort_id: returnCohort!.id },
    ])
    await supabase.from('member_join_date_overrides').insert({ member_id: overridden!.id, first_joined_at: '2024-02-02' })

    await reprocess()
    const firstHandoff = await fetchMember(emailHandoff)
    const firstReturn = await fetchMember(emailReturn)
    const firstOverride = await fetchMember(emailOverride)
    expect(firstHandoff?.first_joined_at).toBe('2026-01-18')
    expect(firstHandoff?.most_recent_joined_at).toBe('2026-01-18')
    expect(firstReturn?.first_joined_at).toBe('2023-04-18')
    expect(firstReturn?.most_recent_joined_at).toBe('2026-06-14')
    // A join-date override still wins over the computed first-joined date.
    expect(firstOverride?.first_joined_at).toBe('2024-02-02')

    await reprocess()
    for (const [email, before] of [[emailHandoff, firstHandoff], [emailReturn, firstReturn], [emailOverride, firstOverride]] as const) {
      const after = await fetchMember(email)
      expect(after?.first_joined_at).toBe(before?.first_joined_at)
      expect(after?.most_recent_joined_at).toBe(before?.most_recent_joined_at)
      expect(after?.id).toBe(before?.id)
    }
  })
})
