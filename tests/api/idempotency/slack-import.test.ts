import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * Test to verify /api/import/slack is idempotent
 *
 * CRITICAL: Slack import must be idempotent - importing the same data
 * multiple times should not create duplicate records.
 *
 * Pattern: UPSERT by unique constraints on each Bronze table:
 * - slack_users: user_id
 * - slack_channels: channel_id
 * - slack_messages: (channel_id, message_ts)
 * - slack_reactions: (channel_id, message_ts, reaction, user_id)
 */
describe('Slack Import Idempotency', () => {
  const supabase = getTestSupabaseAdminClient()
  const authHeaders = getTestAuthHeaders()

  const testUserId = `TEST_USER_${Date.now()}`
  const testChannelId = `TEST_CHANNEL_${Date.now()}`
  const testMessageTs = `${Date.now()}.000001`

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase.from('slack_reactions').delete().like('channel_id', 'TEST_CHANNEL_%')
    await supabase.from('slack_messages').delete().like('channel_id', 'TEST_CHANNEL_%')
    await supabase.from('slack_channels').delete().like('channel_id', 'TEST_CHANNEL_%')
    await supabase.from('slack_users').delete().like('user_id', 'TEST_USER_%')
  })

  afterAll(async () => {
    // Clean up test data
    await supabase.from('slack_reactions').delete().like('channel_id', 'TEST_CHANNEL_%')
    await supabase.from('slack_messages').delete().like('channel_id', 'TEST_CHANNEL_%')
    await supabase.from('slack_channels').delete().like('channel_id', 'TEST_CHANNEL_%')
    await supabase.from('slack_users').delete().like('user_id', 'TEST_USER_%')
  })

  // Helper to convert array of objects to CSV format
  function createTestCSV(data: any[]): File {
    if (data.length === 0) {
      return new File([''], 'test.csv', { type: 'text/csv' })
    }

    const headers = Object.keys(data[0])
    const csvLines = [headers.join(',')]

    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header]
        if (value === null || value === undefined) return ''
        if (typeof value === 'object') {
          // JSON fields need to be stringified and quoted
          return `"${JSON.stringify(value).replace(/"/g, '""')}"`
        }
        if (typeof value === 'boolean') return value.toString()
        // Escape quotes and wrap in quotes if contains comma
        const str = String(value)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      csvLines.push(values.join(','))
    }

    const csvContent = csvLines.join('\n')
    return new File([csvContent], 'test.csv', { type: 'text/csv' })
  }

  it('should create records on first import', async () => {
    // ARRANGE: Create test data
    const usersData = [
      {
        user_id: testUserId,
        email: 'test@example.com',
        name: 'Test User',
        display_name: 'testuser',
        real_name: 'Test User',
        is_bot: false,
        is_deleted: false,
        raw_payload: { id: testUserId },
      },
    ]

    const channelsData = [
      {
        channel_id: testChannelId,
        name: 'test-channel',
        is_private: false,
        is_archived: false,
        member_count: 10,
        topic: 'Test channel',
        purpose: 'Testing',
        created: '2099-01-01T00:00:00Z',
        raw_payload: { id: testChannelId },
      },
    ]

    const messagesData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Hello world',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        reply_users_count: 0,
        occurred_at: '2099-01-01T12:00:00Z',
        edited_at: null,
        deleted_at: null,
        files: null,
        raw_payload: { ts: testMessageTs },
      },
    ]

    const reactionsData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        reaction: 'thumbsup',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        occurred_at: '2099-01-01T12:01:00Z',
        removed_at: null,
        raw_payload: { reaction: 'thumbsup' },
      },
    ]

    const usersFile = createTestCSV(usersData)
    const channelsFile = createTestCSV(channelsData)
    const messagesFile = createTestCSV(messagesData)
    const reactionsFile = createTestCSV(reactionsData)

    // ACT: POST to /api/import/slack
    const formData = new FormData()
    formData.append('users', usersFile)
    formData.append('channels', channelsFile)
    formData.append('messages', messagesFile)
    formData.append('reactions', reactionsFile)

    const response = await fetch('http://localhost:3000/api/import/slack', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    // ASSERT: Import successful
    expect(response.ok).toBe(true)
    const result = await response.json()
    expect(result.success).toBe(true)
    expect(result.imported.users).toBe(1)
    expect(result.imported.channels).toBe(1)
    expect(result.imported.messages).toBe(1)
    expect(result.imported.reactions).toBe(1)

    // Verify records created in database
    const { data: users } = await supabase
      .from('slack_users')
      .select('*')
      .eq('user_id', testUserId)

    const { data: channels } = await supabase
      .from('slack_channels')
      .select('*')
      .eq('channel_id', testChannelId)

    const { data: messages } = await supabase
      .from('slack_messages')
      .select('*')
      .eq('channel_id', testChannelId)
      .eq('message_ts', testMessageTs)

    const { data: reactions } = await supabase
      .from('slack_reactions')
      .select('*')
      .eq('channel_id', testChannelId)
      .eq('message_ts', testMessageTs)

    expect(users).toHaveLength(1)
    expect(channels).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(reactions).toHaveLength(1)
  })

  it('should not create duplicates when re-importing same data (idempotent)', async () => {
    // ARRANGE: Same test data as first import
    const usersData = [
      {
        user_id: testUserId,
        email: 'test@example.com',
        name: 'Test User',
        display_name: 'testuser',
        real_name: 'Test User',
        is_bot: false,
        is_deleted: false,
        raw_payload: { id: testUserId },
      },
    ]

    const channelsData = [
      {
        channel_id: testChannelId,
        name: 'test-channel',
        is_private: false,
        is_archived: false,
        member_count: 10,
        topic: 'Test channel',
        purpose: 'Testing',
        created: '2099-01-01T00:00:00Z',
        raw_payload: { id: testChannelId },
      },
    ]

    const messagesData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Hello world',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        reply_users_count: 0,
        occurred_at: '2099-01-01T12:00:00Z',
        edited_at: null,
        deleted_at: null,
        files: null,
        raw_payload: { ts: testMessageTs },
      },
    ]

    const reactionsData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        reaction: 'thumbsup',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        occurred_at: '2099-01-01T12:01:00Z',
        removed_at: null,
        raw_payload: { reaction: 'thumbsup' },
      },
    ]

    const usersFile = createTestCSV(usersData)
    const channelsFile = createTestCSV(channelsData)
    const messagesFile = createTestCSV(messagesData)
    const reactionsFile = createTestCSV(reactionsData)

    // ACT: Re-import same data
    const formData = new FormData()
    formData.append('users', usersFile)
    formData.append('channels', channelsFile)
    formData.append('messages', messagesFile)
    formData.append('reactions', reactionsFile)

    const response = await fetch('http://localhost:3000/api/import/slack', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    expect(response.ok).toBe(true)
    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: Still only 1 record of each type (no duplicates)
    const { data: users } = await supabase
      .from('slack_users')
      .select('*')
      .eq('user_id', testUserId)

    const { data: channels } = await supabase
      .from('slack_channels')
      .select('*')
      .eq('channel_id', testChannelId)

    const { data: messages } = await supabase
      .from('slack_messages')
      .select('*')
      .eq('channel_id', testChannelId)
      .eq('message_ts', testMessageTs)

    const { data: reactions } = await supabase
      .from('slack_reactions')
      .select('*')
      .eq('channel_id', testChannelId)
      .eq('message_ts', testMessageTs)

    expect(users).toHaveLength(1)
    expect(channels).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(reactions).toHaveLength(1)
  })

  it('should update existing records when re-importing with changed data', async () => {
    // ARRANGE: Same IDs but different data
    const usersData = [
      {
        user_id: testUserId,
        email: 'updated@example.com', // Changed email
        name: 'Updated User', // Changed name
        display_name: 'updateduser',
        real_name: 'Updated User',
        is_bot: false,
        is_deleted: false,
        raw_payload: { id: testUserId, updated: true },
      },
    ]

    const channelsData = [
      {
        channel_id: testChannelId,
        name: 'test-channel',
        is_private: false,
        is_archived: true, // Changed to archived
        member_count: 15, // Changed member count
        topic: 'Updated topic', // Changed topic
        purpose: 'Testing',
        created: '2099-01-01T00:00:00Z',
        raw_payload: { id: testChannelId, archived: true },
      },
    ]

    const messagesData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testUserId,
        user_email: 'updated@example.com',
        user_name: 'Updated User',
        text: 'Hello world (edited)', // Changed text
        message_type: 'message',
        thread_ts: null,
        reply_count: 2, // Changed reply count
        reply_users_count: 1,
        occurred_at: '2099-01-01T12:00:00Z',
        edited_at: '2099-01-01T13:00:00Z', // Added edit timestamp
        deleted_at: null,
        files: null,
        raw_payload: { ts: testMessageTs, edited: true },
      },
    ]

    const reactionsData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        reaction: 'thumbsup',
        user_id: testUserId,
        user_email: 'updated@example.com',
        user_name: 'Updated User',
        occurred_at: '2099-01-01T12:01:00Z',
        removed_at: '2099-01-01T14:00:00Z', // Added removal timestamp
        raw_payload: { reaction: 'thumbsup', removed: true },
      },
    ]

    const usersFile = createTestCSV(usersData)
    const channelsFile = createTestCSV(channelsData)
    const messagesFile = createTestCSV(messagesData)
    const reactionsFile = createTestCSV(reactionsData)

    // ACT: Import with updated data
    const formData = new FormData()
    formData.append('users', usersFile)
    formData.append('channels', channelsFile)
    formData.append('messages', messagesFile)
    formData.append('reactions', reactionsFile)

    const response = await fetch('http://localhost:3000/api/import/slack', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    expect(response.ok).toBe(true)

    // ASSERT: Records updated (still only 1 of each)
    const { data: users } = await supabase
      .from('slack_users')
      .select('*')
      .eq('user_id', testUserId)
      .single()

    const { data: channels } = await supabase
      .from('slack_channels')
      .select('*')
      .eq('channel_id', testChannelId)
      .single()

    const { data: messages } = await supabase
      .from('slack_messages')
      .select('*')
      .eq('channel_id', testChannelId)
      .eq('message_ts', testMessageTs)
      .single()

    const { data: reactions } = await supabase
      .from('slack_reactions')
      .select('*')
      .eq('channel_id', testChannelId)
      .eq('message_ts', testMessageTs)
      .single()

    // Verify updates were applied
    expect(users?.email).toBe('updated@example.com')
    expect(users?.name).toBe('Updated User')

    expect(channels?.is_archived).toBe(true)
    expect(channels?.member_count).toBe(15)
    expect(channels?.topic).toBe('Updated topic')

    expect(messages?.text).toBe('Hello world (edited)')
    expect(messages?.reply_count).toBe(2)
    expect(messages?.edited_at).toBe('2099-01-01T13:00:00+00:00')

    expect(reactions?.removed_at).toBe('2099-01-01T14:00:00+00:00')
  })

  it('should handle multiple import cycles without creating duplicates', async () => {
    // ARRANGE: Import same data 5 times
    const usersData = [
      {
        user_id: testUserId,
        email: 'test@example.com',
        name: 'Test User',
        display_name: 'testuser',
        real_name: 'Test User',
        is_bot: false,
        is_deleted: false,
        raw_payload: { id: testUserId },
      },
    ]

    const channelsData = [
      {
        channel_id: testChannelId,
        name: 'test-channel',
        is_private: false,
        is_archived: false,
        member_count: 10,
        topic: 'Test channel',
        purpose: 'Testing',
        created: '2099-01-01T00:00:00Z',
        raw_payload: { id: testChannelId },
      },
    ]

    const messagesData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Hello world',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        reply_users_count: 0,
        occurred_at: '2099-01-01T12:00:00Z',
        edited_at: null,
        deleted_at: null,
        files: null,
        raw_payload: { ts: testMessageTs },
      },
    ]

    const reactionsData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        reaction: 'thumbsup',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        occurred_at: '2099-01-01T12:01:00Z',
        removed_at: null,
        raw_payload: { reaction: 'thumbsup' },
      },
    ]

    // ACT: Import 5 times
    for (let i = 0; i < 5; i++) {
      const usersFile = createTestCSV(usersData)
      const channelsFile = createTestCSV(channelsData)
      const messagesFile = createTestCSV(messagesData)
      const reactionsFile = createTestCSV(reactionsData)

      const formData = new FormData()
      formData.append('users', usersFile)
      formData.append('channels', channelsFile)
      formData.append('messages', messagesFile)
      formData.append('reactions', reactionsFile)

      const response = await fetch('http://localhost:3000/api/import/slack', {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      })

      expect(response.ok).toBe(true)
    }

    // ASSERT: Still only 1 record of each type (completely idempotent)
    const { data: users } = await supabase
      .from('slack_users')
      .select('*')
      .eq('user_id', testUserId)

    const { data: channels } = await supabase
      .from('slack_channels')
      .select('*')
      .eq('channel_id', testChannelId)

    const { data: messages } = await supabase
      .from('slack_messages')
      .select('*')
      .eq('channel_id', testChannelId)

    const { data: reactions } = await supabase
      .from('slack_reactions')
      .select('*')
      .eq('channel_id', testChannelId)

    expect(users).toHaveLength(1)
    expect(channels).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(reactions).toHaveLength(1)
  })

  it('should handle multiple messages in same channel (different message_ts)', async () => {
    // ARRANGE: Add second message to same channel
    const testMessageTs2 = `${Date.now()}.000002`

    const usersData = [
      {
        user_id: testUserId,
        email: 'test@example.com',
        name: 'Test User',
        display_name: 'testuser',
        real_name: 'Test User',
        is_bot: false,
        is_deleted: false,
        raw_payload: { id: testUserId },
      },
    ]

    const channelsData = [
      {
        channel_id: testChannelId,
        name: 'test-channel',
        is_private: false,
        is_archived: false,
        member_count: 10,
        topic: 'Test channel',
        purpose: 'Testing',
        created: '2099-01-01T00:00:00Z',
        raw_payload: { id: testChannelId },
      },
    ]

    const messagesData = [
      {
        message_ts: testMessageTs2, // Different timestamp
        channel_id: testChannelId, // Same channel
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Second message',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        reply_users_count: 0,
        occurred_at: '2099-01-01T12:05:00Z',
        edited_at: null,
        deleted_at: null,
        files: null,
        raw_payload: { ts: testMessageTs2 },
      },
    ]

    const reactionsData = [
      {
        message_ts: testMessageTs2,
        channel_id: testChannelId,
        reaction: 'heart',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        occurred_at: '2099-01-01T12:06:00Z',
        removed_at: null,
        raw_payload: { reaction: 'heart' },
      },
    ]

    const usersFile = createTestCSV(usersData)
    const channelsFile = createTestCSV(channelsData)
    const messagesFile = createTestCSV(messagesData)
    const reactionsFile = createTestCSV(reactionsData)

    // ACT: Import second message
    const formData = new FormData()
    formData.append('users', usersFile)
    formData.append('channels', channelsFile)
    formData.append('messages', messagesFile)
    formData.append('reactions', reactionsFile)

    const response = await fetch('http://localhost:3000/api/import/slack', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    expect(response.ok).toBe(true)

    // ASSERT: Now 2 messages in same channel
    const { data: messages } = await supabase
      .from('slack_messages')
      .select('*')
      .eq('channel_id', testChannelId)
      .order('message_ts')

    const { data: reactions } = await supabase
      .from('slack_reactions')
      .select('*')
      .eq('channel_id', testChannelId)
      .order('message_ts')

    expect(messages).toHaveLength(2)
    expect(messages?.[0]?.message_ts).toBe(testMessageTs)
    expect(messages?.[1]?.message_ts).toBe(testMessageTs2)

    expect(reactions).toHaveLength(2)
    expect(reactions?.[0]?.reaction).toBe('thumbsup')
    expect(reactions?.[1]?.reaction).toBe('heart')
  })

  it('should handle multiple reactions on same message (different reaction or user)', async () => {
    // ARRANGE: Add second reaction from different user
    const testUserId2 = `TEST_USER_${Date.now()}_2`

    const usersData = [
      {
        user_id: testUserId,
        email: 'test@example.com',
        name: 'Test User',
        display_name: 'testuser',
        real_name: 'Test User',
        is_bot: false,
        is_deleted: false,
        raw_payload: { id: testUserId },
      },
      {
        user_id: testUserId2,
        email: 'test2@example.com',
        name: 'Test User 2',
        display_name: 'testuser2',
        real_name: 'Test User 2',
        is_bot: false,
        is_deleted: false,
        raw_payload: { id: testUserId2 },
      },
    ]

    const channelsData = [
      {
        channel_id: testChannelId,
        name: 'test-channel',
        is_private: false,
        is_archived: false,
        member_count: 10,
        topic: 'Test channel',
        purpose: 'Testing',
        created: '2099-01-01T00:00:00Z',
        raw_payload: { id: testChannelId },
      },
    ]

    const messagesData = [
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Hello world',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        reply_users_count: 0,
        occurred_at: '2099-01-01T12:00:00Z',
        edited_at: null,
        deleted_at: null,
        files: null,
        raw_payload: { ts: testMessageTs },
      },
    ]

    const reactionsData = [
      // Original reaction (testUserId, thumbsup)
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        reaction: 'thumbsup',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        occurred_at: '2099-01-01T12:01:00Z',
        removed_at: null,
        raw_payload: { reaction: 'thumbsup' },
      },
      // Same user, different reaction
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        reaction: 'heart',
        user_id: testUserId,
        user_email: 'test@example.com',
        user_name: 'Test User',
        occurred_at: '2099-01-01T12:02:00Z',
        removed_at: null,
        raw_payload: { reaction: 'heart' },
      },
      // Different user, same reaction as first
      {
        message_ts: testMessageTs,
        channel_id: testChannelId,
        reaction: 'thumbsup',
        user_id: testUserId2,
        user_email: 'test2@example.com',
        user_name: 'Test User 2',
        occurred_at: '2099-01-01T12:03:00Z',
        removed_at: null,
        raw_payload: { reaction: 'thumbsup', user2: true },
      },
    ]

    const usersFile = createTestCSV(usersData)
    const channelsFile = createTestCSV(channelsData)
    const messagesFile = createTestCSV(messagesData)
    const reactionsFile = createTestCSV(reactionsData)

    // ACT: Import multiple reactions
    const formData = new FormData()
    formData.append('users', usersFile)
    formData.append('channels', channelsFile)
    formData.append('messages', messagesFile)
    formData.append('reactions', reactionsFile)

    const response = await fetch('http://localhost:3000/api/import/slack', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    expect(response.ok).toBe(true)

    // ASSERT: 3+ reactions on same message (original thumbsup + heart + heart from previous test + new reactions)
    const { data: reactions } = await supabase
      .from('slack_reactions')
      .select('*')
      .eq('channel_id', testChannelId)
      .eq('message_ts', testMessageTs)
      .order('occurred_at')

    expect(reactions!.length).toBeGreaterThanOrEqual(3)

    // Verify unique constraint works: same user can't react with same emoji twice
    const user1Thumbsups = reactions?.filter(
      r => r.user_id === testUserId && r.reaction === 'thumbsup'
    )
    expect(user1Thumbsups).toHaveLength(1)

    const user1Hearts = reactions?.filter(
      r => r.user_id === testUserId && r.reaction === 'heart'
    )
    expect(user1Hearts).toHaveLength(1)

    const user2Thumbsups = reactions?.filter(
      r => r.user_id === testUserId2 && r.reaction === 'thumbsup'
    )
    expect(user2Thumbsups).toHaveLength(1)
  })
})
