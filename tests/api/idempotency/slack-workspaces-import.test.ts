import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { useFakeClock } from '../../helpers/fake-clock'

/**
 * The Slack import with the app installed in two workspaces. One workspace per request: the import for the second
 * files everything under it, leaves the primary workspace's rows alone, and is safe to repeat. Slack is mocked,
 * the local DB is real. (Two workspaces holding the same Slack id is covered by the in-memory contract and webhook
 * tests; the database allows it only after the old keys are dropped, docs/SLACK_WORKSPACES.md.)
 */
const suffix = Date.now()
const teamId = `TTEST${suffix}`
const channelId = `TEST_WS_CHAN_${suffix}`
const userId = `TEST_WS_USER_${suffix}`
const nowSec = Math.floor(Date.now() / 1000)

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { list: async () => ({ members: [{ id: userId, name: 'ws-user', real_name: 'Workspace User', profile: {} }] }) }
    emoji = { list: async () => ({ emoji: {} }) }
    conversations = {
      list: async ({ types }: { types?: string }) =>
        types === 'mpim' ? { channels: [] } : { channels: [{ id: channelId, name: 'ws-general', is_private: false, is_archived: false, is_member: true }] },
      join: async () => ({ ok: true }),
      history: async () => ({ messages: [{ ts: `${nowSec - 300}.000100`, user: userId, text: 'hello from the second workspace' }] }),
      replies: async () => ({ messages: [] }),
      members: async () => ({ members: [userId] }),
    }
  },
}))
vi.mock('@/lib/chat/emoji-copy', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/chat/emoji-copy')>()), copyEmojiImages: vi.fn(async () => ({ copied: 0, failed: 0 })) }))
vi.mock('@/lib/supabase/api-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/processing/trigger', () => ({ triggerReprocessing: vi.fn(async () => ({ processed: [] })) }))
vi.mock('@/lib/supabase/service', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() }
})

import { requireAdmin } from '@/lib/supabase/api-auth'
import { POST } from '@/app/api/import/slack-api/route'

const supabase = getTestSupabaseAdminClient()
const bronze = (table: string) => supabase.schema('bronze').from(table)

async function cleanup() {
  await bronze('slack_channel_members').delete().eq('channel_id', channelId)
  await bronze('slack_channel_member_events').delete().eq('channel_id', channelId)
  await bronze('slack_reactions').delete().eq('channel_id', channelId)
  await bronze('slack_messages').delete().eq('channel_id', channelId)
  await bronze('slack_channels').delete().eq('channel_id', channelId)
  await bronze('slack_users').delete().eq('user_id', userId)
  await supabase.from('slack_workspaces').delete().eq('team_id', teamId)
}

async function runImport(workspace: string) {
  const response = await POST(new NextRequest('http://localhost/api/import/slack-api', { method: 'POST', body: JSON.stringify({ daysBack: 1, workspace }) }))
  return { status: response.status, body: await response.json() }
}

describe('Slack import into a second workspace', () => {
  useFakeClock()
  let workspaceId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'admin' } as any, forbidden: false, supabase } as any)
    await cleanup()
    const { data, error } = await supabase.from('slack_workspaces').insert({ team_id: teamId, name: 'Second test workspace' }).select('id').single()
    if (error) throw new Error(error.message)
    workspaceId = data.id
  })
  afterAll(cleanup)

  it('files the users, channels, messages and members under the workspace asked for, and again is a no-op', async () => {
    const first = await runImport(teamId)
    expect(first.status, JSON.stringify(first.body)).toBe(200)

    const counts = async () => ({
      channels: (await bronze('slack_channels').select('workspace_id').eq('channel_id', channelId)).data,
      users: (await bronze('slack_users').select('workspace_id').eq('user_id', userId)).data,
      messages: (await bronze('slack_messages').select('workspace_id, text').eq('channel_id', channelId)).data,
      members: (await bronze('slack_channel_members').select('workspace_id').eq('channel_id', channelId)).data,
    })
    const stored = await counts()
    expect(stored.channels).toEqual([{ workspace_id: workspaceId }])
    expect(stored.users).toEqual([{ workspace_id: workspaceId }])
    expect(stored.messages).toEqual([{ workspace_id: workspaceId, text: 'hello from the second workspace' }])
    expect(stored.members).toEqual([{ workspace_id: workspaceId }])

    expect((await runImport(teamId)).status).toBe(200)
    expect(await counts()).toEqual(stored)
  })

  it('refuses a workspace the Hub does not know', async () => {
    const result = await runImport(`TSTRANGER${suffix}`)
    expect(result.status).toBe(400)
    expect(result.body.error).toContain('Unknown Slack workspace')
    expect((await bronze('slack_messages').select('id').eq('channel_id', channelId)).data).toEqual([])
  })
})
