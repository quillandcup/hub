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
 * Status classification: lead / active / cancelled, plus is_trial / has_trialed.
 *
 * A "real" subscription offer (subscription===true, no trial) counts toward
 * 'cancelled' once its purchase is deactivated. A trial-enabled subscription
 * offer only counts once its purchase survives past the trial window before
 * deactivating — cancelling *during* the trial leaves the contact a 'lead'
 * (never converted), with has_trialed=true marking that they tried it once.
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
    expect(member?.is_trial).toBe(false)
    expect(member?.has_trialed).toBe(false)
  })

  it('classifies a trial cancelled before converting as lead, with has_trialed=true', async () => {
    await reprocess()
    const member = await fetchMember(emailLeadFromTrial)
    expect(member?.status).toBe('lead')
    expect(member?.is_trial).toBe(false)
    expect(member?.has_trialed).toBe(true)
  })

  it('marks a currently active trial as active with is_trial=true', async () => {
    await reprocess()
    const member = await fetchMember(emailActiveTrial)
    expect(member?.status).toBe('active')
    expect(member?.is_trial).toBe(true)
    expect(member?.has_trialed).toBe(true)
  })

  it('flips is_trial=false once an active trial purchase survives past its trial window, keeping has_trialed=true', async () => {
    await reprocess()
    const member = await fetchMember(emailConverts)
    expect(member?.status).toBe('active')
    expect(member?.is_trial).toBe(false)
    expect(member?.has_trialed).toBe(true)
  })
})
