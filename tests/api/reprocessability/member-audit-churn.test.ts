import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * reprocess_members_atomic writes a member's Kajabi-derived status and then, in the same
 * transaction, re-applies status overrides. For a member whose override disagrees with Kajabi
 * (a gift on a contact with no purchases) that is lead -> active, which the audit log used to
 * record as two rows (active -> lead, lead -> active) on every run for no change. The audit
 * trigger now keeps a transaction's net effect, so a no-op reprocess adds nothing.
 */
describe('Members reprocessing does not churn the audit log', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const email = `audit-churn-${ts}@example.com`
  let memberId = ''
  let overrideId = ''

  async function processMembers() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    }
  }

  async function memberAuditRowCount() {
    const { count, error } = await supabase
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'member')
      .eq('entity_id', memberId)
    expect(error).toBeNull()
    return count ?? 0
  }

  beforeAll(async () => {
    // A Kajabi contact with no purchases derives 'lead'; the gift override then forces 'active'.
    const { error: contactError } = await supabase
      .schema('bronze')
      .from('kajabi_contacts')
      .insert({
        kajabi_contact_id: `audit-churn-contact-${ts}`,
        email,
        name: 'Audit Churn',
        created_at_kajabi: '2022-01-01T00:00:00Z',
        data: {},
      })
    expect(contactError).toBeNull()

    await processMembers()
    const { data: member } = await supabase.from('members').select('id').eq('email', email).single()
    memberId = member!.id

    const { data: override, error: overrideError } = await supabase
      .from('member_status_overrides')
      .insert({ member_id: memberId, override_type: 'gift', reason: 'audit churn test', starts_at: new Date().toISOString() })
      .select('id')
      .single()
    expect(overrideError).toBeNull()
    overrideId = override!.id
  })

  afterAll(async () => {
    await supabase.from('member_status_overrides').delete().eq('id', overrideId)
    await supabase.schema('bronze').from('kajabi_contacts').delete().eq('email', email)
    await supabase.from('audit_log').delete().eq('entity_type', 'member').eq('entity_id', memberId)
    await supabase.from('members').delete().eq('email', email)
  })

  it('logs the real status change once, then nothing for a reprocess that changes nothing', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('id', memberId).single()
    expect(member?.status).toBe('active')

    const { data: rows } = await supabase
      .from('audit_log')
      .select('changes')
      .eq('entity_type', 'member')
      .eq('entity_id', memberId)
      .eq('action', 'update')
    const statusRows = (rows ?? []).filter(r => (r.changes as Record<string, unknown>).status)
    expect(statusRows).toHaveLength(1)
    expect((statusRows[0].changes as { status: unknown }).status).toEqual({ old: 'lead', new: 'active' })

    const before = await memberAuditRowCount()
    await processMembers()
    await processMembers()
    expect(await memberAuditRowCount()).toBe(before)
  })
})
