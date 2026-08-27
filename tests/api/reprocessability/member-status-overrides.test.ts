import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * member_status_overrides must actually stick after reprocessing — this is
 * the fix for the bug where a manually-set 'on_hiatus' status got silently
 * reverted to the Kajabi-derived value on every nightly sync (see
 * app/api/process/members/route.ts and the reprocess_members_atomic
 * override step it relies on).
 */
describe('Member Status Overrides applied during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const emailHiatus = `override-hiatus-${ts}@example.com`
  const emailGift = `override-gift-${ts}@example.com`
  const emailExpired = `override-expired-${ts}@example.com`

  let memberIds: Record<string, string> = {}
  const overrideIds: string[] = []

  async function processMembers() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    }
    return response.json()
  }

  beforeAll(async () => {
    // Three active Kajabi-paying members — without an override, all three
    // would come out of Kajabi-derived processing as 'active'.
    const { data: members, error } = await supabase.from('members').insert([
      { name: 'Override Hiatus', email: emailHiatus, joined_at: '2023-01-01', status: 'active' },
      { name: 'Override Gift', email: emailGift, joined_at: '2023-01-01', status: 'active' },
      { name: 'Override Expired', email: emailExpired, joined_at: '2023-01-01', status: 'active' },
    ]).select('id, email')

    expect(error).toBeNull()
    members?.forEach(m => { memberIds[m.email] = m.id })

    const { data: overrides, error: overrideError } = await supabase
      .from('member_status_overrides')
      .insert([
        // Batch insert requires every row to specify the same columns explicitly —
        // supabase-js sends `null` (not "omit, use DB default") for a column absent
        // on a given row if any other row in the batch specifies it.
        { member_id: memberIds[emailHiatus], override_type: 'hiatus', reason: 'test hiatus', starts_at: new Date().toISOString() },
        { member_id: memberIds[emailGift], override_type: 'gift', reason: 'test gift', starts_at: new Date().toISOString() },
        {
          // Expired hiatus — should NOT apply, member stays whatever Kajabi says
          member_id: memberIds[emailExpired],
          override_type: 'hiatus',
          reason: 'test expired hiatus',
          starts_at: '2020-01-01T00:00:00Z',
          expires_at: '2020-06-01T00:00:00Z',
        },
      ])
      .select('id')

    expect(overrideError).toBeNull()
    overrideIds.push(...(overrides?.map(o => o.id) ?? []))
  })

  afterAll(async () => {
    await supabase.from('member_status_overrides').delete().in('id', overrideIds)
    await supabase.from('members').delete().in('email', [emailHiatus, emailGift, emailExpired])
  })

  it('forces status to on_hiatus for an active hiatus override', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailHiatus).single()
    expect(member?.status).toBe('on_hiatus')
  })

  it('keeps status on_hiatus after a second reprocess run (does not revert)', async () => {
    await processMembers()
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailHiatus).single()
    expect(member?.status).toBe('on_hiatus')
  })

  it('forces status to active for a gift override', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailGift).single()
    expect(member?.status).toBe('active')
  })

  it('does not apply an override whose expires_at is in the past', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailExpired).single()
    // This member has no Bronze Kajabi contact, so nothing else would touch
    // their status — if the date-window filter in the override step were
    // broken, this expired override would incorrectly force on_hiatus.
    expect(member?.status).toBe('active')
  })
})
