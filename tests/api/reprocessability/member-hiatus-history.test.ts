import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * member_hiatus_history must actually stick after reprocessing — this is
 * the hiatus-specific half of the fix for the bug where a manually-set
 * 'on_hiatus' status got silently reverted to the Kajabi-derived value on
 * every nightly sync (see app/api/process/members/route.ts and Step 4a of
 * reprocess_members_atomic). Also covers hiatus taking precedence over an
 * active gift/180_program override on the same member.
 */
describe('Member Hiatus History applied during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const dateOnly = (d: Date) => d.toISOString().split('T')[0]
  const daysAgo = (n: number) => dateOnly(new Date(Date.now() - n * 24 * 60 * 60 * 1000))
  const daysFromNow = (n: number) => dateOnly(new Date(Date.now() + n * 24 * 60 * 60 * 1000))

  const emailHiatus = `hiatus-active-${ts}@example.com`
  const emailExpired = `hiatus-expired-${ts}@example.com`
  const emailPrecedence = `hiatus-precedence-${ts}@example.com`

  let memberIds: Record<string, string> = {}
  const hiatusIds: string[] = []
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
    // None have a Bronze Kajabi contact, so nothing but the override/hiatus
    // steps touch their status. All start 'cancelled' so a forced status
    // change is only visible if the relevant step actually ran.
    const { data: members, error } = await supabase.from('members').insert([
      { name: 'Hiatus Active', email: emailHiatus, joined_at: '2023-01-01', status: 'cancelled' },
      { name: 'Hiatus Expired', email: emailExpired, joined_at: '2023-01-01', status: 'cancelled' },
      { name: 'Hiatus Precedence', email: emailPrecedence, joined_at: '2023-01-01', status: 'cancelled' },
    ]).select('id, email')

    expect(error).toBeNull()
    members?.forEach(m => { memberIds[m.email] = m.id })

    const { data: hiatuses, error: hiatusError } = await supabase
      .from('member_hiatus_history')
      .insert([
        { member_id: memberIds[emailHiatus], start_date: daysAgo(10), reason: 'test hiatus' },
        {
          // Already-ended hiatus — should NOT apply, member stays whatever it was
          member_id: memberIds[emailExpired],
          start_date: daysAgo(60),
          end_date: daysAgo(30),
          reason: 'test expired hiatus',
        },
        { member_id: memberIds[emailPrecedence], start_date: daysAgo(5), end_date: daysFromNow(5), reason: 'test precedence hiatus' },
      ])
      .select('id')

    expect(hiatusError).toBeNull()
    hiatusIds.push(...(hiatuses?.map(h => h.id) ?? []))

    // emailPrecedence also has an active gift override — hiatus should win.
    const { data: overrides, error: overrideError } = await supabase
      .from('member_status_overrides')
      .insert([
        { member_id: memberIds[emailPrecedence], override_type: 'gift', reason: 'test precedence gift', starts_at: new Date().toISOString() },
      ])
      .select('id')

    expect(overrideError).toBeNull()
    overrideIds.push(...(overrides?.map(o => o.id) ?? []))
  })

  afterAll(async () => {
    await supabase.from('member_hiatus_history').delete().in('id', hiatusIds)
    await supabase.from('member_status_overrides').delete().in('id', overrideIds)
    await supabase.from('members').delete().in('email', [emailHiatus, emailExpired, emailPrecedence])
  })

  it('forces status to on_hiatus for an active hiatus', async () => {
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

  it('does not apply a hiatus that has already ended', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailExpired).single()
    expect(member?.status).toBe('cancelled')
  })

  it('hiatus wins over an active gift override on the same member', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailPrecedence).single()
    expect(member?.status).toBe('on_hiatus')
  })
})
