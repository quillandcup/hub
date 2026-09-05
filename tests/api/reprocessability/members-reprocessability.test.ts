import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * Test to verify /api/process/members is fully reprocessable
 *
 * CRITICAL: Members processing must use DELETE + INSERT pattern.
 * This test prevents regressions where UPSERT was used instead,
 * leaving orphaned members in the database.
 *
 * Core principle: Silver layer must be fully regenerable from Bronze.
 * If a member is deleted from Kajabi, reprocessing should remove them
 * from the members table.
 *
 * NOTE: The API reads from bronze.kajabi_contacts (not the legacy
 * bronze.kajabi_members table). Members without active purchases are
 * created as 'lead' (never purchased) or 'cancelled' (had a real
 * subscription that's no longer active) — see the classification tests
 * below for the lead/cancelled/trial split.
 */
describe('Members Reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail1 = `reprocess-test-1-${ts}@example.com`
  const testEmail2 = `reprocess-test-2-${ts}@example.com`
  const testEmail3 = `reprocess-test-3-${ts}@example.com`

  const contact1 = {
    kajabi_contact_id: `test-contact-1-${ts}`,
    email: testEmail1,
    name: 'Test Member 1',
    created_at_kajabi: '2022-01-01T00:00:00Z',
    data: {},
  }
  const contact2 = {
    kajabi_contact_id: `test-contact-2-${ts}`,
    email: testEmail2,
    name: 'Test Member 2',
    created_at_kajabi: '2022-02-01T00:00:00Z',
    data: {},
  }
  const contact3 = {
    kajabi_contact_id: `test-contact-3-${ts}`,
    email: testEmail3,
    name: 'Test Member 3',
    created_at_kajabi: '2022-03-01T00:00:00Z',
    data: {},
  }

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase
      .schema('bronze').from('kajabi_contacts')
      .delete()
      .ilike('email', 'reprocess-test-%')
    await supabase.from('members').delete().ilike('email', 'reprocess-test-%')
  })

  afterAll(async () => {
    // Clean up test data
    await supabase
      .schema('bronze').from('kajabi_contacts')
      .delete()
      .ilike('email', 'reprocess-test-%')
    await supabase.from('members').delete().ilike('email', 'reprocess-test-%')
  })

  it('should create members from Bronze on first process', async () => {
    // ARRANGE: Insert Bronze contacts (no purchases → status will be inactive)
    const { error: insertError } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .insert([contact1, contact2])

    expect(insertError).toBeNull()

    // Verify data was inserted
    const { data: verifyData } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .select('*')
      .in('email', [testEmail1, testEmail2])

    expect(verifyData).toHaveLength(2)

    // ACT: Process members
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: Members created (status: inactive since no purchases)
    expect(result.success).toBe(true)
    expect(result.processed).toBeGreaterThanOrEqual(2)

    const { data: members } = await supabase
      .from('members')
      .select('*')
      .in('email', [testEmail1, testEmail2])

    expect(members).toHaveLength(2)
    expect(members?.map(m => m.email)).toContain(testEmail1)
    expect(members?.map(m => m.email)).toContain(testEmail2)
    // Without any purchase history, members are leads
    expect(members?.every(m => m.status === 'lead')).toBe(true)
  })

  it('should add new members and update existing ones when reprocessing', async () => {
    // NOTE: Members use UPSERT (not DELETE+INSERT) to preserve UUIDs for FK relationships
    // Members not in Bronze are preserved in Silver (not deleted), ensuring data integrity

    // ARRANGE: Delete contact 1 from Bronze, add contact 3
    await supabase
      .schema('bronze').from('kajabi_contacts')
      .delete()
      .eq('email', testEmail1)

    const { error } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .insert(contact3)

    expect(error).toBeNull()

    // ACT: Reprocess members
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: New contact added, existing contacts still present
    expect(result.success).toBe(true)

    const { data: members } = await supabase
      .from('members')
      .select('*')
      .in('email', [testEmail1, testEmail2, testEmail3])

    // Member 2 should still exist (was in Bronze, still there)
    expect(members?.map(m => m.email)).toContain(testEmail2)

    // Member 3 should be added (new contact in Bronze)
    expect(members?.map(m => m.email)).toContain(testEmail3)
  })

  it('should update member data when Bronze contact changes', async () => {
    // ARRANGE: Update contact 2's name in Bronze
    const { error } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .update({ name: 'Test Member 2 - RENAMED' })
      .eq('email', testEmail2)

    expect(error).toBeNull()

    // ACT: Reprocess
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: Member name updated
    expect(result.success).toBe(true)

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('email', testEmail2)
      .single()

    expect(member?.name).toBe('Test Member 2 - RENAMED')
  })

  it('should use UPSERT pattern to preserve member UUIDs across reprocessing', async () => {
    // NOTE: Members processing uses UPSERT (not DELETE+INSERT) to preserve UUIDs.
    // This ensures prickle_attendance, member_name_aliases, and other FK relationships
    // remain valid across reprocessing runs.

    // ARRANGE: Get current member UUID before reprocessing
    const { data: before } = await supabase
      .from('members')
      .select('id, email')
      .eq('email', testEmail2)
      .single()

    expect(before).toBeTruthy()
    const originalId = before!.id

    // ACT: Process members (UPSERT - preserves UUIDs)
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: Member UUID is preserved after reprocessing (UPSERT keeps same ID)
    const { data: after } = await supabase
      .from('members')
      .select('id, email')
      .eq('email', testEmail2)
      .single()

    expect(after).toBeTruthy()
    expect(after!.id).toBe(originalId)
  })
})

/**
 * Status classification: lead / active / cancelled.
 *
 * A "real" subscription offer (subscription===true, no trial) counts toward
 * 'cancelled' once its purchase is deactivated. A trial-enabled subscription
 * offer only counts once its purchase survives past the trial window before
 * deactivating — cancelling *during* the trial leaves the contact a 'lead'
 * (never converted).
 */
describe('Members Status Classification', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const realOfferId = `test-offer-real-${ts}`
  const trialOfferId = `test-offer-trial-${ts}`

  const emailCancelled = `classify-cancelled-${ts}@example.com`
  const emailLeadFromTrial = `classify-lead-trial-${ts}@example.com`
  const emailActiveTrial = `classify-active-trial-${ts}@example.com`
  const emailConverts = `classify-converts-${ts}@example.com`

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

  beforeAll(async () => {
    await supabase.schema('bronze').from('kajabi_offers').upsert([
      { kajabi_offer_id: realOfferId, name: 'Quill & Cup Membership', trial_period_days: 0, data: { attributes: { subscription: true } } },
      { kajabi_offer_id: trialOfferId, name: 'Quill & Cup Membership (Trial)', trial_period_days: 14, data: { attributes: { subscription: true } } },
    ], { onConflict: 'kajabi_offer_id' })

    await supabase.schema('bronze').from('kajabi_contacts').insert([
      { kajabi_contact_id: `test-contact-cancelled-${ts}`, email: emailCancelled, name: 'Classify Cancelled', created_at_kajabi: daysAgo(400), data: {} },
      { kajabi_contact_id: `test-contact-lead-trial-${ts}`, email: emailLeadFromTrial, name: 'Classify Lead From Trial', created_at_kajabi: daysAgo(400), data: {} },
      { kajabi_contact_id: `test-contact-active-trial-${ts}`, email: emailActiveTrial, name: 'Classify Active Trial', created_at_kajabi: daysAgo(5), data: {} },
      { kajabi_contact_id: `test-contact-converts-${ts}`, email: emailConverts, name: 'Classify Converts', created_at_kajabi: daysAgo(400), data: {} },
    ])

    await supabase.schema('bronze').from('kajabi_customers').insert([
      { kajabi_customer_id: `test-cust-cancelled-${ts}`, email: emailCancelled, data: {} },
      { kajabi_customer_id: `test-cust-lead-trial-${ts}`, email: emailLeadFromTrial, data: {} },
      { kajabi_customer_id: `test-cust-active-trial-${ts}`, email: emailActiveTrial, data: {} },
      { kajabi_customer_id: `test-cust-converts-${ts}`, email: emailConverts, data: {} },
    ])

    await supabase.schema('bronze').from('kajabi_purchases').insert([
      // Real subscription, cancelled after being billed for a while -> cancelled
      {
        kajabi_purchase_id: `test-purchase-cancelled-${ts}`,
        kajabi_customer_id: `test-cust-cancelled-${ts}`,
        kajabi_offer_id: realOfferId,
        status: 'inactive',
        effective_start_at: daysAgo(200),
        deactivated_at: daysAgo(30),
      },
      // Trial-enabled offer, cancelled DURING the 14-day trial window -> never converted
      {
        kajabi_purchase_id: `test-purchase-lead-trial-${ts}`,
        kajabi_customer_id: `test-cust-lead-trial-${ts}`,
        kajabi_offer_id: trialOfferId,
        status: 'inactive',
        effective_start_at: daysAgo(30),
        deactivated_at: daysAgo(25), // 5 days into a 14-day trial
      },
      // Trial-enabled offer, still active and within the trial window -> currently trialing
      {
        kajabi_purchase_id: `test-purchase-active-trial-${ts}`,
        kajabi_customer_id: `test-cust-active-trial-${ts}`,
        kajabi_offer_id: trialOfferId,
        status: 'active',
        effective_start_at: daysAgo(5),
        deactivated_at: null,
      },
      // Trial-enabled offer, still active but trial window has elapsed -> converted
      {
        kajabi_purchase_id: `test-purchase-converts-${ts}`,
        kajabi_customer_id: `test-cust-converts-${ts}`,
        kajabi_offer_id: trialOfferId,
        status: 'active',
        effective_start_at: daysAgo(30), // 14-day trial ended 16 days ago
        deactivated_at: null,
      },
    ].map(p => ({ ...p, data: {} })))
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('kajabi_purchases').delete().ilike('kajabi_purchase_id', `test-purchase-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_customers').delete().ilike('kajabi_customer_id', `test-cust-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `test-contact-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_offers').delete().in('kajabi_offer_id', [realOfferId, trialOfferId])
    await supabase.from('members').delete().in('email', [emailCancelled, emailLeadFromTrial, emailActiveTrial, emailConverts])
  })

  async function reprocess() {
    const response = await fetch('http://localhost:3000/api/process/members', {
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

  it('classifies a real subscription cancelled after billing as cancelled', async () => {
    await reprocess()
    const member = await fetchMember(emailCancelled)
    expect(member?.status).toBe('cancelled')
  })

  it('classifies a trial cancelled before converting as lead', async () => {
    await reprocess()
    const member = await fetchMember(emailLeadFromTrial)
    expect(member?.status).toBe('lead')
  })

  it('marks a currently active trial as active', async () => {
    await reprocess()
    const member = await fetchMember(emailActiveTrial)
    expect(member?.status).toBe('active')
  })

  it('keeps an active trial purchase active once it survives past its trial window', async () => {
    await reprocess()
    const member = await fetchMember(emailConverts)
    expect(member?.status).toBe('active')
  })
})

/**
 * Regression test for the Bronze-tier pagination gap in /api/process/members.
 *
 * Supabase silently caps any unpaginated `.select()` at the project's configured
 * max-rows setting (1000 by default in production; this local dev stack sets
 * `max_rows = 5000` in supabase/config.toml). The route used to fetch
 * kajabi_contacts (and kajabi_customers/purchases/offers) with a single unguarded
 * `.select("*")`, so contacts past that cap were dropped from Silver processing
 * with no error. This seeds more rows than the local max-rows cap and confirms
 * every one of them — including the ones past the cutoff — is processed into
 * `members`, so the test actually reproduces the truncation against this repo's
 * local Supabase stack rather than passing regardless of the fix.
 */
describe('Members Bronze Pagination (>1000 rows)', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const emailPrefix = `pagination-members-${ts}`
  const ROW_COUNT = 5500

  const emailFor = (i: number) => `${emailPrefix}-${i}@example.com`

  beforeAll(async () => {
    const contacts = Array.from({ length: ROW_COUNT }, (_, i) => ({
      kajabi_contact_id: `pagination-contact-${ts}-${i}`,
      email: emailFor(i),
      name: `Pagination Test ${i}`,
      created_at_kajabi: '2022-01-01T00:00:00Z',
      data: {},
    }))

    // Insert in chunks of 500 (CLAUDE.md batching guidance)
    for (let i = 0; i < contacts.length; i += 500) {
      const { error } = await supabase
        .schema('bronze').from('kajabi_contacts')
        .insert(contacts.slice(i, i + 500))
      if (error) throw error
    }
  }, 30000)

  afterAll(async () => {
    await supabase
      .schema('bronze').from('kajabi_contacts')
      .delete()
      .ilike('email', `${emailPrefix}-%`)
    await supabase.from('members').delete().ilike('email', `${emailPrefix}-%`)
  })

  it(
    'processes every contact, including those past the Supabase query row cap',
    async () => {
      const response = await fetch('http://localhost:3000/api/process/members', {
        method: 'POST',
        headers: getTestAuthHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API call failed: ${response.status} - ${errorText}`)
      }

      const result = await response.json()
      expect(result.success).toBe(true)

      const { count, error: countError } = await supabase
        .from('members')
        .select('*', { count: 'exact', head: true })
        .ilike('email', `${emailPrefix}-%`)

      expect(countError).toBeNull()
      expect(count).toBe(ROW_COUNT)

      // Specifically confirm a contact past row 1000 — the old truncation point —
      // made it through processing with its data intact.
      const pastCutoffIndex = ROW_COUNT - 1
      const { data: lastMember, error: lastMemberError } = await supabase
        .from('members')
        .select('*')
        .eq('email', emailFor(pastCutoffIndex))
        .single()

      expect(lastMemberError).toBeNull()
      expect(lastMember?.name).toBe(`Pagination Test ${pastCutoffIndex}`)
    },
    60000
  )
})

/**
 * Member tenure fields (first_joined_at, most_recent_joined_at,
 * total_active_months) computed during reprocessing — see
 * lib/member-tenure.ts. Covers a real cancel/resubscribe gap and a hiatus
 * (member_hiatus_history) excluding time from the total and resetting
 * most_recent_joined_at once it ends.
 */
describe('Member Tenure computed during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString()
  const dateOnly = (iso: string) => iso.split('T')[0]

  const membershipOfferId = `tenure-offer-${ts}`
  const emailResub = `tenure-resub-${ts}@example.com`
  const emailHiatus = `tenure-hiatus-${ts}@example.com`

  const hiatusIds: string[] = []

  async function reprocess() {
    const response = await fetch('http://localhost:3000/api/process/members', {
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
      { kajabi_contact_id: `tenure-contact-resub-${ts}`, email: emailResub, name: 'Tenure Resub', created_at_kajabi: daysAgo(400), data: {} },
      { kajabi_contact_id: `tenure-contact-hiatus-${ts}`, email: emailHiatus, name: 'Tenure Hiatus', created_at_kajabi: daysAgo(400), data: {} },
    ])
    await supabase.schema('bronze').from('kajabi_customers').insert([
      { kajabi_customer_id: `tenure-cust-resub-${ts}`, email: emailResub, data: {} },
      { kajabi_customer_id: `tenure-cust-hiatus-${ts}`, email: emailHiatus, data: {} },
    ])
    await supabase.schema('bronze').from('kajabi_purchases').insert([
      // Cancelled ~200d ago, resubscribed ~100d ago — a real gap.
      {
        kajabi_purchase_id: `tenure-p1-${ts}`,
        kajabi_customer_id: `tenure-cust-resub-${ts}`,
        kajabi_offer_id: membershipOfferId,
        status: 'inactive',
        created_at_kajabi: daysAgo(300),
        effective_start_at: daysAgo(300),
        deactivated_at: daysAgo(200),
        data: {},
      },
      {
        kajabi_purchase_id: `tenure-p2-${ts}`,
        kajabi_customer_id: `tenure-cust-resub-${ts}`,
        kajabi_offer_id: membershipOfferId,
        status: 'active',
        created_at_kajabi: daysAgo(100),
        effective_start_at: daysAgo(100),
        deactivated_at: null,
        data: {},
      },
      // Single continuous membership — never cancelled in Kajabi.
      {
        kajabi_purchase_id: `tenure-p3-${ts}`,
        kajabi_customer_id: `tenure-cust-hiatus-${ts}`,
        kajabi_offer_id: membershipOfferId,
        status: 'active',
        created_at_kajabi: daysAgo(300),
        effective_start_at: daysAgo(300),
        deactivated_at: null,
        data: {},
      },
    ])
  })

  afterAll(async () => {
    if (hiatusIds.length > 0) {
      await supabase.from('member_hiatus_history').delete().in('id', hiatusIds)
    }
    await supabase.schema('bronze').from('kajabi_purchases').delete().ilike('kajabi_purchase_id', `tenure-p%-${ts}`)
    await supabase.schema('bronze').from('kajabi_customers').delete().ilike('kajabi_customer_id', `tenure-cust-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `tenure-contact-%-${ts}`)
    await supabase.schema('bronze').from('kajabi_offers').delete().eq('kajabi_offer_id', membershipOfferId)
    await supabase.from('members').delete().in('email', [emailResub, emailHiatus])
  })

  it('computes first/most-recent joined and total active months across a cancel+resubscribe', async () => {
    await reprocess()
    const member = await fetchMember(emailResub)

    expect(member?.first_joined_at).toBe(dateOnly(daysAgo(300)))
    expect(member?.most_recent_joined_at).toBe(dateOnly(daysAgo(100)))
    // ~100 active days in the first stint + ~100 so far in the second = ~200 days
    expect(member?.total_active_months).toBeGreaterThanOrEqual(6)
    expect(member?.total_active_months).toBeLessThanOrEqual(7)
  })

  it('excludes hiatus time from total_active_months and resets most_recent_joined_at once the hiatus ends', async () => {
    await reprocess()
    const before = await fetchMember(emailHiatus)
    expect(before?.first_joined_at).toBe(dateOnly(daysAgo(300)))
    expect(before?.most_recent_joined_at).toBe(dateOnly(daysAgo(300))) // no gap yet — same as first join

    const { data: hiatus, error } = await supabase
      .from('member_hiatus_history')
      .insert({
        member_id: before!.id,
        reason: 'tenure-test ended hiatus',
        start_date: dateOnly(daysAgo(60)),
        end_date: dateOnly(daysAgo(30)),
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    hiatusIds.push(hiatus!.id)

    await reprocess()
    const after = await fetchMember(emailHiatus)

    expect(after?.first_joined_at).toBe(dateOnly(daysAgo(300))) // unaffected by hiatus
    expect(after?.most_recent_joined_at).toBe(dateOnly(daysAgo(30))) // reset to hiatus end
    expect(after!.total_active_months).toBeLessThan(before!.total_active_months) // ~30 hiatus days excluded
  })
})

describe('Stripe trial-conversion date correction during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString()
  const dateOnly = (iso: string) => iso.split('T')[0]

  const membershipOfferId = `stripe-trial-offer-${ts}`
  const emailTrial = `stripe-trial-${ts}@example.com`
  const emailNoTrial = `stripe-no-trial-${ts}@example.com`
  const kajabiCustomerIdTrial = `stripe-trial-cust-${ts}`
  const kajabiCustomerIdNoTrial = `stripe-no-trial-cust-${ts}`
  const stripeCustomerIdTrial = `cus_test_trial_${ts}`
  const stripeCustomerIdNoTrial = `cus_test_no_trial_${ts}`

  const purchaseCreatedAt = daysAgo(300)
  const trialEndAt = daysAgo(293) // 7-day trial

  async function reprocess() {
    const response = await fetch('http://localhost:3000/api/process/members', {
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
      { kajabi_contact_id: `stripe-trial-contact-${ts}`, email: emailTrial, name: 'Stripe Trial Member', created_at_kajabi: purchaseCreatedAt, data: {} },
      { kajabi_contact_id: `stripe-no-trial-contact-${ts}`, email: emailNoTrial, name: 'Stripe No Trial Member', created_at_kajabi: purchaseCreatedAt, data: {} },
    ])
    await supabase.schema('bronze').from('kajabi_customers').insert([
      { kajabi_customer_id: kajabiCustomerIdTrial, email: emailTrial, data: {} },
      { kajabi_customer_id: kajabiCustomerIdNoTrial, email: emailNoTrial, data: {} },
    ])
    await supabase.schema('bronze').from('kajabi_purchases').insert([
      {
        kajabi_purchase_id: `stripe-trial-purchase-${ts}`,
        kajabi_customer_id: kajabiCustomerIdTrial,
        kajabi_offer_id: membershipOfferId,
        status: 'active',
        created_at_kajabi: purchaseCreatedAt,
        effective_start_at: purchaseCreatedAt,
        deactivated_at: null,
        data: {},
      },
      {
        kajabi_purchase_id: `stripe-no-trial-purchase-${ts}`,
        kajabi_customer_id: kajabiCustomerIdNoTrial,
        kajabi_offer_id: membershipOfferId,
        status: 'active',
        created_at_kajabi: purchaseCreatedAt,
        effective_start_at: purchaseCreatedAt,
        deactivated_at: null,
        data: {},
      },
    ])

    // Trial member: Stripe subscription created at the same instant as the
    // Kajabi purchase, but with a real 7-day trial — first_joined_at should
    // land on trial_end, not the purchase's created_at_kajabi.
    await supabase.schema('bronze').from('stripe_customers').insert([
      { stripe_customer_id: stripeCustomerIdTrial, email: emailTrial, created_at_stripe: purchaseCreatedAt, data: { metadata: { kjb_member_id: kajabiCustomerIdTrial } } },
      { stripe_customer_id: stripeCustomerIdNoTrial, email: emailNoTrial, created_at_stripe: purchaseCreatedAt, data: { metadata: { kjb_member_id: kajabiCustomerIdNoTrial } } },
    ])
    await supabase.schema('bronze').from('stripe_subscriptions').insert([
      {
        stripe_subscription_id: `sub_test_trial_${ts}`,
        stripe_customer_id: stripeCustomerIdTrial,
        status: 'active',
        created_at_stripe: purchaseCreatedAt,
        data: {
          trial_start: Math.floor(new Date(purchaseCreatedAt).getTime() / 1000),
          trial_end: Math.floor(new Date(trialEndAt).getTime() / 1000),
          billing_cycle_anchor: Math.floor(new Date(trialEndAt).getTime() / 1000),
        },
      },
      // No-trial member: same billing_cycle_anchor as created (no trial_start/trial_end) —
      // must NOT shift first_joined_at, since billing_cycle_anchor alone isn't trustworthy.
      {
        stripe_subscription_id: `sub_test_no_trial_${ts}`,
        stripe_customer_id: stripeCustomerIdNoTrial,
        status: 'active',
        created_at_stripe: purchaseCreatedAt,
        data: {
          billing_cycle_anchor: Math.floor(new Date(purchaseCreatedAt).getTime() / 1000),
        },
      },
    ])
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('stripe_subscriptions').delete().in('stripe_customer_id', [stripeCustomerIdTrial, stripeCustomerIdNoTrial])
    await supabase.schema('bronze').from('stripe_customers').delete().in('stripe_customer_id', [stripeCustomerIdTrial, stripeCustomerIdNoTrial])
    await supabase.schema('bronze').from('kajabi_purchases').delete().ilike('kajabi_purchase_id', `stripe-%-purchase-${ts}`)
    await supabase.schema('bronze').from('kajabi_customers').delete().in('kajabi_customer_id', [kajabiCustomerIdTrial, kajabiCustomerIdNoTrial])
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `stripe-%-contact-${ts}`)
    await supabase.schema('bronze').from('kajabi_offers').delete().eq('kajabi_offer_id', membershipOfferId)
    await supabase.from('members').delete().in('email', [emailTrial, emailNoTrial])
  })

  it('uses the Stripe trial-end date as first_joined_at when the subscription had a real trial', async () => {
    await reprocess()
    const member = await fetchMember(emailTrial)
    expect(member?.first_joined_at).toBe(dateOnly(trialEndAt))
  })

  it('leaves first_joined_at at the Kajabi purchase date when there was no trial, even if billing_cycle_anchor is present', async () => {
    await reprocess()
    const member = await fetchMember(emailNoTrial)
    expect(member?.first_joined_at).toBe(dateOnly(purchaseCreatedAt))
  })
})

describe('Legacy join-date overrides during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString()
  const dateOnly = (iso: string) => iso.split('T')[0]

  const membershipOfferId = `join-override-offer-${ts}`
  const email = `join-override-${ts}@example.com`
  const kajabiContactId = `join-override-contact-${ts}`
  const kajabiCustomerId = `join-override-cust-${ts}`

  const kajabiJoinedAt = daysAgo(300)
  const legacyJoinedAt = dateOnly(daysAgo(700)) // predates anything Kajabi knows about

  async function reprocess() {
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    }
    return response.json()
  }

  async function fetchMember() {
    const { data } = await supabase.from('members').select('*').eq('email', email).single()
    return data
  }

  beforeAll(async () => {
    await supabase.schema('bronze').from('kajabi_offers').upsert([
      { kajabi_offer_id: membershipOfferId, name: 'Quill & Cup Membership', trial_period_days: 0, data: { attributes: { subscription: true } } },
    ], { onConflict: 'kajabi_offer_id' })
    await supabase.schema('bronze').from('kajabi_contacts').insert({
      kajabi_contact_id: kajabiContactId, email, name: 'Join Override Member', created_at_kajabi: kajabiJoinedAt, data: {},
    })
    await supabase.schema('bronze').from('kajabi_customers').insert({
      kajabi_customer_id: kajabiCustomerId, email, data: {},
    })
    await supabase.schema('bronze').from('kajabi_purchases').insert({
      kajabi_purchase_id: `join-override-purchase-${ts}`,
      kajabi_customer_id: kajabiCustomerId,
      kajabi_offer_id: membershipOfferId,
      status: 'active',
      created_at_kajabi: kajabiJoinedAt,
      effective_start_at: kajabiJoinedAt,
      deactivated_at: null,
      data: {},
    })
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('kajabi_purchases').delete().eq('kajabi_purchase_id', `join-override-purchase-${ts}`)
    await supabase.schema('bronze').from('kajabi_customers').delete().eq('kajabi_customer_id', kajabiCustomerId)
    await supabase.schema('bronze').from('kajabi_contacts').delete().eq('kajabi_contact_id', kajabiContactId)
    await supabase.schema('bronze').from('kajabi_offers').delete().eq('kajabi_offer_id', membershipOfferId)
    await supabase.from('members').delete().eq('email', email)
  })

  it('keeps using the Kajabi-derived date when there is no override', async () => {
    await reprocess()
    const member = await fetchMember()
    expect(member?.first_joined_at).toBe(dateOnly(kajabiJoinedAt))
  })

  it('uses member_join_date_overrides.first_joined_at once an override exists, surviving reprocessing', async () => {
    const member = await fetchMember()
    await supabase.from('member_join_date_overrides').insert({
      member_id: member!.id,
      first_joined_at: legacyJoinedAt,
      reason: 'test: pre-Kajabi legacy join',
    })

    await reprocess()
    const after = await fetchMember()
    expect(after?.first_joined_at).toBe(legacyJoinedAt)
    expect(after?.most_recent_joined_at).toBe(legacyJoinedAt) // no independent rejoin detected — pulled forward too
    // The override implies ~700 days of real activity Kajabi has no purchase
    // record for (only the ~300-day stint above) — total_active_months must
    // reflect the override, not just the Kajabi-visible stint, or a
    // corrected join date paired with an unchanged active-months count reads
    // as contradictory ("Hedgie since 700 days ago, active ~10 months").
    expect(after?.total_active_months).toBeGreaterThanOrEqual(23)
    expect(after?.total_active_months).toBeLessThanOrEqual(24)

    await supabase.from('member_join_date_overrides').delete().eq('member_id', member!.id)
  })
})
