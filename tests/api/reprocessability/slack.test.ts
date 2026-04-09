import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * Test to verify /api/process/slack is fully reprocessable
 *
 * CRITICAL: Slack processing must use DELETE + INSERT pattern.
 * This test prevents regressions where UPSERT was used instead,
 * leaving orphaned activities in the database.
 *
 * Core principle: Silver layer must be fully regenerable from Bronze.
 * If a message is deleted from Slack, reprocessing should remove the
 * corresponding activity from member_activities.
 */
describe('Slack Reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const testMemberId = '00000000-0000-0000-0000-000000000001' // Valid UUID
  const testSlackUserId = 'U_TEST_REPROCESS'
  const testEmail = 'slack-reprocess@example.com'

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase.from('slack_users').delete().eq('user_id', testSlackUserId)
    await supabase.from('slack_messages').delete().like('message_ts', 'TEST_%')
    await supabase.from('slack_reactions').delete().like('message_ts', 'TEST_%')
    await supabase
      .from('member_activities')
      .delete()
      .eq('source', 'slack')
      .gte('occurred_at', '2099-04-01')
      .lte('occurred_at', '2099-04-02')
    await supabase.from('members').delete().eq('id', testMemberId)

    // Insert test member
    const { error: memberError } = await supabase.from('members').insert({
      id: testMemberId,
      email: testEmail,
      name: 'Test Slack Member',
      joined_at: '2022-01-01',
      status: 'active',
    })
    if (memberError) {
      console.error('Failed to insert test member:', memberError)
      throw memberError
    }

    // Insert test Slack user (for matching)
    await supabase.from('slack_users').insert({
      user_id: testSlackUserId,
      email: testEmail,
      name: 'test_user',
      display_name: 'Test User',
      real_name: 'Test Slack Member',
      is_bot: false,
      is_deleted: false,
      imported_at: new Date().toISOString(),
      raw_payload: {},
    })
  })

  afterAll(async () => {
    // Clean up test data
    await supabase.from('slack_users').delete().eq('user_id', testSlackUserId)
    await supabase.from('slack_messages').delete().like('message_ts', 'TEST_%')
    await supabase.from('slack_reactions').delete().like('message_ts', 'TEST_%')
    await supabase
      .from('member_activities')
      .delete()
      .eq('source', 'slack')
      .gte('occurred_at', '2099-04-01')
      .lte('occurred_at', '2099-04-02')
    await supabase.from('members').delete().eq('id', testMemberId)
  })

  it('should create member_activities from Bronze on first process', async () => {
    // ARRANGE: Insert Bronze data (Slack messages)
    const testMessages = [
      {
        message_ts: 'TEST_001',
        channel_id: 'C_TEST',
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testSlackUserId,
        user_email: testEmail,
        user_name: 'Test User',
        text: 'Hello world',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        occurred_at: '2099-04-01T10:00:00Z',
        deleted_at: null,
        files: null,
        imported_at: new Date().toISOString(),
        raw_payload: {},
      },
      {
        message_ts: 'TEST_002',
        channel_id: 'C_TEST',
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testSlackUserId,
        user_email: testEmail,
        user_name: 'Test User',
        text: 'Goodbye',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        occurred_at: '2099-04-01T11:00:00Z',
        deleted_at: null,
        files: null,
        imported_at: new Date().toISOString(),
        raw_payload: {},
      },
    ]

    const { error: insertError } = await supabase.from('slack_messages').insert(testMessages)
    expect(insertError).toBeNull()

    // Verify data was inserted
    const { data: verifyData, error: verifyError } = await supabase
      .from('slack_messages')
      .select('*')
      .in('message_ts', ['TEST_001', 'TEST_002'])

    expect(verifyError).toBeNull()
    expect(verifyData).toHaveLength(2)

    // ACT: Process Slack messages
    const response = await fetch('http://localhost:3000/api/process/slack', {
      method: 'POST',
      headers: {
        ...getTestAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromDate: '2099-04-01',
        toDate: '2099-04-02',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: Activities created
    expect(result.success).toBe(true)

    const { data: activities } = await supabase
      .from('member_activities')
      .select('*')
      .eq('source', 'slack')
      .eq('member_id', testMemberId)
      .gte('occurred_at', '2099-04-01')
      .lte('occurred_at', '2099-04-02')

    expect(activities).toBeDefined()
    expect(activities?.length).toBeGreaterThanOrEqual(2)
  })

  it('should remove deleted messages when reprocessing', async () => {
    // ARRANGE: Mark one message as deleted
    await supabase
      .from('slack_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('message_ts', 'TEST_002')

    // Verify deletion was applied
    const { data: deletedMsg } = await supabase
      .from('slack_messages')
      .select('deleted_at')
      .eq('message_ts', 'TEST_002')
      .single()

    expect(deletedMsg?.deleted_at).not.toBeNull()

    // ACT: Reprocess Slack messages
    const response = await fetch('http://localhost:3000/api/process/slack', {
      method: 'POST',
      headers: {
        ...getTestAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromDate: '2099-04-01',
        toDate: '2099-04-02',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: Deleted message activity removed
    expect(result.success).toBe(true)

    const { data: activities } = await supabase
      .from('member_activities')
      .select('*')
      .eq('source', 'slack')
      .eq('member_id', testMemberId)
      .gte('occurred_at', '2099-04-01')
      .lte('occurred_at', '2099-04-02')

    // Should only have TEST_001 activity (TEST_002 was deleted)
    const deletedMessageActivity = activities?.find(
      (a) => a.metadata?.message_ts === 'TEST_002'
    )
    expect(deletedMessageActivity).toBeUndefined()

    // TEST_001 should still exist
    const activeMessageActivity = activities?.find(
      (a) => a.metadata?.message_ts === 'TEST_001'
    )
    expect(activeMessageActivity).toBeDefined()
  })

  it('should verify DELETE + INSERT pattern (not UPSERT)', async () => {
    // ARRANGE: Insert an activity directly into Silver (bypassing Bronze)
    // This simulates orphaned data that UPSERT would keep
    const orphanActivity = {
      member_id: testMemberId,
      activity_type: 'slack_message',
      activity_category: 'communication',
      title: 'Posted in #orphan-channel',
      description: null,
      source: 'slack',
      occurred_at: '2099-04-01T12:00:00Z',
      engagement_value: 10,
      related_id: 'C_ORPHAN:ORPHAN_MESSAGE',
      metadata: {
        message_ts: 'ORPHAN_MESSAGE',
        channel_id: 'C_ORPHAN',
        channel_name: 'orphan-channel',
      },
    }

    const { error: insertError } = await supabase.from('member_activities').insert(orphanActivity)
    if (insertError) {
      console.error('Failed to insert orphan activity:', insertError)
      throw insertError
    }

    // Verify orphan exists
    const { data: before } = await supabase
      .from('member_activities')
      .select('*')
      .eq('metadata->>message_ts', 'ORPHAN_MESSAGE')
      .single()

    expect(before).toBeTruthy()

    // ACT: Process Slack (should DELETE all activities in date range, then INSERT from Bronze)
    const response = await fetch('http://localhost:3000/api/process/slack', {
      method: 'POST',
      headers: {
        ...getTestAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromDate: '2099-04-01',
        toDate: '2099-04-02',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    expect(result.success).toBe(true)

    // ASSERT: Orphan should be GONE (DELETE + INSERT removes it)
    // If UPSERT was used, orphan would still exist
    const { data: after } = await supabase
      .from('member_activities')
      .select('*')
      .eq('metadata->>message_ts', 'ORPHAN_MESSAGE')
      .single()

    expect(after).toBeNull()
  })
})
