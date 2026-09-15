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
  const staffCanonicalEmail = `staff-status-test-alias-canonical-${ts}@example.com`
  const staffAliasEmail = `staff-status-test-alias-old-${ts}@example.com`

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
    await supabase.from('member_email_aliases').delete().eq('alias_email', staffAliasEmail)
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('email', `staff-status-test-%`)
    await supabase.from('staff').delete().ilike('email', `staff-status-test-%`)
    await supabase.from('members').delete().ilike('email', `staff-status-test-%`)
    await supabase.from('member_email_aliases').delete().eq('alias_email', staffAliasEmail)
  })

  it('staff member with Kajabi contact but no active purchase is active', async () => {
    // ARRANGE: Kajabi contact (no purchase → would normally be a lead) + staff entry
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

  it('non-staff Kajabi contact with no purchase history is a lead', async () => {
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

    // ASSERT: lead (never purchased, not staff)
    const { data: member } = await supabase
      .from('members')
      .select('status, staff_role')
      .eq('email', regularMemberEmail)
      .single()

    expect(member?.status).toBe('lead')
    expect(member?.staff_role).toBeNull()
  })

  it('staff member with a stray alias Kajabi contact still gets staff_role/active (regression)', async () => {
    // ARRANGE: two Kajabi contacts for the same person — an old personal
    // email (aliased to the canonical one) plus their real/canonical
    // contact — mirroring a staff member whose old address got merged in
    // via member_email_aliases. Regression for a bug where the staff merge
    // ran per-contact BEFORE alias/canonical dedup: whichever contact
    // processed first consumed the one-shot staff match, so if the alias
    // contact happened to win the dedup collision, the canonical contact
    // that survived into `members` never got staff_role/status='active'.
    await supabase.from('member_email_aliases').insert({
      alias_email: staffAliasEmail,
      canonical_email: staffCanonicalEmail,
      source: 'manual',
    })
    await supabase.schema('bronze').from('kajabi_contacts').insert([
      {
        kajabi_contact_id: `staff-alias-old-${ts}`,
        email: staffAliasEmail,
        name: 'Staff Alias',
        created_at_kajabi: '2021-01-01T00:00:00Z',
        data: {},
      },
      {
        kajabi_contact_id: `staff-alias-canonical-${ts}`,
        email: staffCanonicalEmail,
        name: 'Staff Canonical',
        created_at_kajabi: '2022-01-01T00:00:00Z',
        data: {},
      },
    ])
    await supabase.from('staff').insert({
      email: staffCanonicalEmail,
      name: 'Staff Canonical',
      role: 'owner',
      hire_date: '2020-01-01',
    })

    // ACT
    const result = await processMembers()
    expect(result.success).toBe(true)

    // ASSERT: the surviving (canonical) member row is active with staff_role set
    const { data: member } = await supabase
      .from('members')
      .select('status, staff_role, email')
      .eq('email', staffCanonicalEmail)
      .single()

    expect(member?.status).toBe('active')
    expect(member?.staff_role).toBe('owner')
  })

  it('reprocessing preserves an existing members.user_id for a non-staff member', async () => {
    // Regression for a bug where reprocess_members_atomic unconditionally
    // overwrote members.user_id from the payload (which only ever carried a
    // value via staff.user_id) on every run, silently wiping any link
    // established directly on a member (e.g. via the admin Member picker or
    // an invite) for anyone who isn't also a staff record.
    const linkedMemberEmail = `staff-status-test-linked-${ts}@example.com`
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: `staff-status-test-auth-${ts}@example.com`,
      email_confirm: true,
    })
    if (authError || !authUser.user) throw new Error(`Failed to create test auth user: ${authError?.message}`)

    try {
      await supabase.schema('bronze').from('kajabi_contacts').insert({
        kajabi_contact_id: `linked-${ts}`,
        email: linkedMemberEmail,
        name: 'Linked Member',
        created_at_kajabi: '2022-01-01T00:00:00Z',
        data: {},
      })
      // Establish the link the same way the admin Member picker / invite
      // flow would, directly on the member — no staff record involved.
      await processMembers()
      await supabase.from('members').update({ user_id: authUser.user.id }).eq('email', linkedMemberEmail)

      // ACT: reprocess again, as if a scheduled Kajabi sync ran.
      const result = await processMembers()
      expect(result.success).toBe(true)

      // ASSERT: the link survives.
      const { data: member } = await supabase
        .from('members')
        .select('user_id')
        .eq('email', linkedMemberEmail)
        .single()

      expect(member?.user_id).toBe(authUser.user.id)
    } finally {
      await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {})
    }
  })

  it('reprocessing backfills staff.member_id to match the resolved member', async () => {
    const backfillEmail = `staff-status-test-backfill-${ts}@example.com`

    await supabase.schema('bronze').from('kajabi_contacts').insert({
      kajabi_contact_id: `backfill-${ts}`,
      email: backfillEmail,
      name: 'Backfill Staffer',
      created_at_kajabi: '2022-01-01T00:00:00Z',
      data: {},
    })
    await supabase.from('staff').insert({
      email: backfillEmail,
      name: 'Backfill Staffer',
      role: 'staff',
    })

    const result = await processMembers()
    expect(result.success).toBe(true)

    const { data: member } = await supabase
      .from('members')
      .select('id')
      .eq('email', backfillEmail)
      .single()
    const { data: staffRow } = await supabase
      .from('staff')
      .select('member_id')
      .eq('email', backfillEmail)
      .single()

    expect(staffRow?.member_id).toBe(member?.id)
  })
})
