import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Staff members must always be active regardless of Kajabi subscription status.
 *
 * Staff work for the company and attend prickles. If their Kajabi subscription
 * lapses (or they never had one), the member processor must not set them inactive —
 * that would silently exclude them from Zoom name matching and drop their attendance.
 */
describe('Staff Member Status', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const staffWithKajabiEmail = `staff-status-test-kajabi-${ts}@example.com`
  const staffOnlyEmail = `staff-status-test-only-${ts}@example.com`
  const regularMemberEmail = `staff-status-test-regular-${ts}@example.com`

  async function processMembers() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API call failed: ${response.status} - ${text}`)
    }
    return response.json()
  }

  beforeAll(async () => {
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('email', `staff-status-test-%`)
    await supabase.from('staff').delete().ilike('email', `staff-status-test-%`)
    await supabase.from('members').delete().ilike('email', `staff-status-test-%`)
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('email', `staff-status-test-%`)
    await supabase.from('staff').delete().ilike('email', `staff-status-test-%`)
    await supabase.from('members').delete().ilike('email', `staff-status-test-%`)
  })

  it('staff member with Kajabi contact but no active purchase is active', async () => {
    // ARRANGE: Kajabi contact (no purchase → would normally be inactive) + staff entry
    await supabase.schema('bronze').from('kajabi_contacts').insert({
      kajabi_contact_id: `staff-kajabi-${ts}`,
      email: staffWithKajabiEmail,
      name: 'Staff With Kajabi',
      created_at_kajabi: '2022-01-01T00:00:00Z',
      data: {},
    })
    await supabase.from('staff').insert({
      email: staffWithKajabiEmail,
      name: 'Staff With Kajabi',
      role: 'staff',
      hire_date: '2022-01-01',
    })

    // ACT
    const result = await processMembers()
    expect(result.success).toBe(true)

    // ASSERT: active despite no Kajabi purchase
    const { data: member } = await supabase
      .from('members')
      .select('status, staff_role')
      .eq('email', staffWithKajabiEmail)
      .single()

    expect(member?.status).toBe('active')
    expect(member?.staff_role).toBe('staff')
  })

  it('staff member with no Kajabi record at all is active', async () => {
    // ARRANGE: staff table entry only — no Kajabi contact
    await supabase.from('staff').insert({
      email: staffOnlyEmail,
      name: 'Staff Only',
      role: 'owner',
      hire_date: '2020-01-01',
    })

    // ACT
    const result = await processMembers()
    expect(result.success).toBe(true)

    // ASSERT: created as active
    const { data: member } = await supabase
      .from('members')
      .select('status, staff_role, name')
      .eq('email', staffOnlyEmail)
      .single()

    expect(member?.status).toBe('active')
    expect(member?.staff_role).toBe('owner')
    expect(member?.name).toBe('Staff Only')
  })

  it('non-staff Kajabi contact with no active purchase remains inactive', async () => {
    // ARRANGE: Kajabi contact, no purchase, NOT in staff table
    await supabase.schema('bronze').from('kajabi_contacts').insert({
      kajabi_contact_id: `regular-${ts}`,
      email: regularMemberEmail,
      name: 'Regular Member',
      created_at_kajabi: '2022-06-01T00:00:00Z',
      data: {},
    })

    // ACT
    const result = await processMembers()
    expect(result.success).toBe(true)

    // ASSERT: inactive (no subscription, not staff)
    const { data: member } = await supabase
      .from('members')
      .select('status, staff_role')
      .eq('email', regularMemberEmail)
      .single()

    expect(member?.status).toBe('inactive')
    expect(member?.staff_role).toBeNull()
  })
})
