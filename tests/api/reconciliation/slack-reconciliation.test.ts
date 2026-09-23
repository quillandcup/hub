import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for GET /api/analyze/slack-reconciliation
 *
 * Tests the key business logic:
 * 1. Active Slack users matched to members are reported in members_in_slack
 *
 * Note: this route used to also return `orphan_slack_users` (unmatched/bot/
 * deleted/ignored Slack users), but that was intentionally removed in
 * "Consolidate data hygiene and reconciliation into one dashboard" —
 * orphan detection now lives at /admin/hygiene/unmatched-slack instead, so
 * it isn't duplicated here. The tests covering that removed behavior were
 * deleted along with it rather than left pointing at a dead field.
 */
describe('Slack Reconciliation', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const userIds = {
    matchedUser: `U_matched_${ts}`,
  }

  const emails = {
    matched: `slack-recon-matched-${ts}@example.com`,
  }

  let memberId: string

  beforeAll(async () => {
    // Member that will match the active Slack user
    const { data: member } = await supabase
      .from('members')
      .insert({ name: `Slack Matched ${ts}`, email: emails.matched, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberId = member!.id

    // Slack user
    await supabase.schema('bronze').from('slack_users').insert([
      {
        user_id: userIds.matchedUser,
        email: emails.matched,
        real_name: `Matched User ${ts}`,
        display_name: `matched_${ts}`,
        is_bot: false,
        is_deleted: false,
        raw_payload: {},
      },
    ])
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('slack_users')
      .delete().in('user_id', Object.values(userIds))
    await supabase.from('members').delete().eq('id', memberId)
  })

  async function fetchSlackReconciliation() {
    const response = await fetch(
      `${getTestApiBaseUrl()}/api/analyze/slack-reconciliation`,
      { headers: getTestAuthHeaders() }
    )
    const body = await response.json()
    expect(response.ok, `API returned ${response.status}: ${JSON.stringify(body)}`).toBe(true)
    return body as { total_in_slack: number; members_in_slack: string[] }
  }

  it('includes matched active Slack users in members_in_slack', async () => {
    const result = await fetchSlackReconciliation()
    expect(result.members_in_slack).toContain(memberId)
  })
})
