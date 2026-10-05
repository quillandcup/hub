import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { useFakeClock } from '../../helpers/fake-clock'

/**
 * What the Slack import captures besides channel messages: group DMs the bot
 * is in, who is in each conversation, custom emoji and message files. Slack is
 * mocked, the local DB and Storage are real.
 *
 * Each is pulled on every import (the workspace is on Slack's free plan, so
 * anything not copied in time is gone), must be safe to re-import, and soft
 * deletes what Slack stops reporting. The webhook applies the same changes as
 * they happen; its handlers are tested here too.
 */
const suffix = Date.now()
const channelId = `TEST_CAPTURE_CHAN_${suffix}`
const groupDmId = `TEST_CAPTURE_MPIM_${suffix}`
const alice = `TEST_CAPTURE_ALICE_${suffix}`
const bob = `TEST_CAPTURE_BOB_${suffix}`
const nowSec = Math.floor(Date.now() / 1000)
const emojiA = `test_capture_hedgie_${suffix}`
const emojiAlias = `test_capture_hog_${suffix}`

const missingScope = () => Object.assign(new Error('missing_scope'), { data: { error: 'missing_scope' } })

// Mutable per test: what Slack answers.
const slack = {
  hasMpimScope: true,
  members: new Map<string, string[] | Error>(),
  emoji: {} as Record<string, string> | Error,
  history: new Map<string, Record<string, any>[]>(),
}

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = {
      list: async () => ({
        members: [
          { id: alice, name: 'capture-alice', real_name: 'Capture Alice', profile: {} },
          { id: bob, name: 'capture-bob', real_name: 'Capture Bob', profile: {} },
        ],
      }),
    }
    emoji = {
      list: async () => {
        if (slack.emoji instanceof Error) throw slack.emoji
        return { emoji: slack.emoji }
      },
    }
    conversations = {
      list: async ({ types }: { types?: string }) => {
        if (types === 'mpim') {
          if (!slack.hasMpimScope) throw missingScope()
          return { channels: [{ id: groupDmId, name: `mpdm-capture-alice--capture-bob-1`, is_mpim: true, is_private: true }] }
        }
        return { channels: [{ id: channelId, name: 'capture-test', is_private: false, is_archived: false, is_member: true }] }
      },
      join: async () => ({ ok: true }),
      history: async ({ channel }: { channel: string }) => ({ messages: slack.history.get(channel) ?? [] }),
      replies: async () => ({ messages: [] }),
      members: async ({ channel }: { channel: string }) => {
        const members = slack.members.get(channel)
        if (members instanceof Error) throw members
        return { members: members ?? [] }
      },
    }
  },
}))

vi.mock('@/lib/supabase/api-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/processing/trigger', () => ({ triggerReprocessing: vi.fn(async () => ({ processed: [] })) }))
vi.mock('@/lib/supabase/service', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() }
})

import { requireAdmin } from '@/lib/supabase/api-auth'
import { POST } from '@/app/api/import/slack-api/route'
import {
  applySlackEmojiEvent,
  applySlackMembershipEvent,
  copySlackFiles,
  MAX_SLACK_FILE_BYTES,
  SLACK_FILES_BUCKET,
} from '@/lib/slack-capture'

const supabase = getTestSupabaseAdminClient()
const bronze = (table: string) => supabase.schema('bronze').from(table)
const fileIds = [1, 2, 3, 4].map((n) => `TEST_CAPTURE_FILE_${suffix}_${n}`)

async function cleanup() {
  const { data: files } = await bronze('slack_files').select('storage_path').in('file_id', fileIds)
  const paths = (files ?? []).map((f) => f.storage_path).filter(Boolean)
  if (paths.length > 0) await supabase.storage.from(SLACK_FILES_BUCKET).remove(paths)
  await bronze('slack_files').delete().in('file_id', fileIds)
  await bronze('slack_custom_emoji').delete().like('name', `test_capture_%_${suffix}`)
  await bronze('slack_channel_members').delete().in('channel_id', [channelId, groupDmId])
  await bronze('slack_reactions').delete().in('channel_id', [channelId, groupDmId])
  await bronze('slack_messages').delete().in('channel_id', [channelId, groupDmId])
  await bronze('slack_channels').delete().in('channel_id', [channelId, groupDmId])
  await bronze('slack_users').delete().in('user_id', [alice, bob])
}

async function runImport() {
  const response = await POST(
    new NextRequest('http://localhost/api/import/slack-api', { method: 'POST', body: JSON.stringify({ daysBack: 1 }) })
  )
  const body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  return body
}

const membersOf = async (channel: string) => {
  const { data } = await bronze('slack_channel_members').select('user_id, left_at, first_seen_at').eq('channel_id', channel).order('user_id')
  return data ?? []
}
const emojiRows = async () => {
  const { data } = await bronze('slack_custom_emoji')
    .select('name, image_url, alias_for, removed_at')
    .like('name', `test_capture_%_${suffix}`)
    .order('name')
  return data ?? []
}

describe('Slack import: group DMs, membership, emoji and files', () => {
  const fake = useFakeClock()

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'admin' } as any, forbidden: false, supabase } as any)
    slack.hasMpimScope = true
    slack.members = new Map([
      [channelId, [alice, bob]],
      [groupDmId, [alice, bob]],
    ])
    slack.emoji = { [emojiA]: 'https://emoji.example.test/hedgie.png', [emojiAlias]: `alias:${emojiA}` }
    slack.history = new Map([
      [channelId, [{ ts: `${nowSec - 300}.000100`, user: alice, text: 'in the channel' }]],
      [groupDmId, [{ ts: `${nowSec - 200}.000200`, user: bob, text: 'in the group DM' }]],
    ])
    await cleanup()
  })

  afterAll(cleanup)

  describe('group DMs', () => {
    it('stores a group DM the bot is in as an is_mpim conversation, with its messages', async () => {
      const body = await runImport()

      const { data: channels } = await bronze('slack_channels').select('channel_id, is_mpim, is_private').in('channel_id', [channelId, groupDmId]).order('channel_id')
      expect(channels).toEqual([
        { channel_id: channelId, is_mpim: false, is_private: false },
        { channel_id: groupDmId, is_mpim: true, is_private: true },
      ])
      const { data: messages } = await bronze('slack_messages').select('channel_type, text').eq('channel_id', groupDmId)
      expect(messages).toEqual([{ channel_type: 'mpim', text: 'in the group DM' }])
      expect(body.capture.groupDms).toEqual({ conversations: 1 })
      expect(body.capture.errors).toEqual([])
    })

    it('skips group DMs and emoji, without failing, until the app has their scopes', async () => {
      slack.hasMpimScope = false
      slack.emoji = missingScope()

      const body = await runImport()

      expect(body.capture.groupDms).toEqual({ skipped: 'missing_scope' })
      expect(body.capture.emoji.skipped).toBe('missing_scope')
      expect(body.capture.errors).toEqual([])
      const { data: messages } = await bronze('slack_messages').select('text').eq('channel_id', channelId)
      expect(messages).toEqual([{ text: 'in the channel' }])
      expect(await emojiRows()).toEqual([])
    })
  })

  describe('channel membership', () => {
    it('records who is in each conversation, and re-importing changes nothing', async () => {
      const first = await runImport()
      const before = await membersOf(channelId)
      expect(before.map((m) => [m.user_id, m.left_at])).toEqual([[alice, null], [bob, null]])
      expect((await membersOf(groupDmId)).map((m) => m.user_id)).toEqual([alice, bob])
      expect(first.capture.membership).toMatchObject({ channelsSynced: 2, channelsFailed: 0, members: 4, left: 0 })

      await runImport()
      expect(await membersOf(channelId)).toEqual(before)
    })

    it('soft-deletes a member who left, and clears it when they come back', async () => {
      await runImport()
      const [aliceBefore] = await membersOf(channelId)

      slack.members.set(channelId, [alice])
      const afterLeave = await runImport()
      expect(afterLeave.capture.membership.left).toBe(1)
      const [, bobGone] = await membersOf(channelId)
      expect(bobGone.user_id).toBe(bob)
      expect(bobGone.left_at).not.toBeNull()

      slack.members.set(channelId, [alice, bob])
      await runImport()
      const [aliceAfter, bobBack] = await membersOf(channelId)
      expect(bobBack.left_at).toBeNull()
      expect(bobBack.first_seen_at).toBe(bobGone.first_seen_at)
      expect(aliceAfter).toEqual(aliceBefore)
    })

    it('leaves a channel untouched when its member list could not be fetched', async () => {
      await runImport()

      // A failed call must not read as everyone leaving.
      slack.members.set(channelId, new Error('ratelimited'))
      slack.members.set(groupDmId, [alice])
      const body = await runImport()

      expect(body.capture.membership).toMatchObject({ channelsSynced: 1, channelsFailed: 1 })
      expect((await membersOf(channelId)).map((m) => [m.user_id, m.left_at])).toEqual([[alice, null], [bob, null]])
      expect((await membersOf(groupDmId)).find((m) => m.user_id === bob)?.left_at).not.toBeNull()
    })

    it('applies member_joined_channel and member_left_channel events', async () => {
      await applySlackMembershipEvent(supabase, { type: 'member_joined_channel', channel: channelId, user: alice })
      await applySlackMembershipEvent(supabase, { type: 'member_joined_channel', channel: channelId, user: alice }) // redelivered
      expect((await membersOf(channelId)).map((m) => [m.user_id, m.left_at])).toEqual([[alice, null]])

      await applySlackMembershipEvent(supabase, { type: 'member_left_channel', channel: channelId, user: alice })
      const [left] = await membersOf(channelId)
      expect(left.left_at).not.toBeNull()

      // A redelivered leave keeps the first leave time.
      fake.clock.advance(60_000)
      await applySlackMembershipEvent(supabase, { type: 'member_left_channel', channel: channelId, user: alice })
      expect((await membersOf(channelId))[0].left_at).toBe(left.left_at)
    })
  })

  describe('custom emoji', () => {
    it('stores images and aliases, and re-importing changes nothing', async () => {
      const body = await runImport()
      const rows = await emojiRows()
      expect(rows).toEqual([
        { name: emojiA, image_url: 'https://emoji.example.test/hedgie.png', alias_for: null, removed_at: null },
        { name: emojiAlias, image_url: null, alias_for: emojiA, removed_at: null },
      ])
      expect(body.capture.emoji.emoji).toBe(2)

      await runImport()
      expect(await emojiRows()).toEqual(rows)
    })

    it('soft-deletes an emoji Slack no longer lists, and restores it if it returns', async () => {
      await runImport()

      slack.emoji = { [emojiA]: 'https://emoji.example.test/hedgie.png' }
      await runImport()
      const removed = (await emojiRows()).find((e) => e.name === emojiAlias)
      expect(removed?.removed_at).not.toBeNull()

      slack.emoji = { [emojiA]: 'https://emoji.example.test/hedgie.png', [emojiAlias]: `alias:${emojiA}` }
      await runImport()
      expect((await emojiRows()).find((e) => e.name === emojiAlias)?.removed_at).toBeNull()
    })

    it('applies emoji_changed add, rename and remove events', async () => {
      await applySlackEmojiEvent(supabase, { subtype: 'add', name: emojiA, value: 'https://emoji.example.test/hedgie.png' })
      expect((await emojiRows()).map((e) => [e.name, e.removed_at])).toEqual([[emojiA, null]])

      await applySlackEmojiEvent(supabase, { subtype: 'rename', old_name: emojiA, new_name: emojiAlias, value: 'https://emoji.example.test/hedgie.png' })
      const afterRename = await emojiRows()
      expect(afterRename.find((e) => e.name === emojiA)?.removed_at).not.toBeNull()
      expect(afterRename.find((e) => e.name === emojiAlias)).toMatchObject({ image_url: 'https://emoji.example.test/hedgie.png', removed_at: null })

      await applySlackEmojiEvent(supabase, { subtype: 'remove', names: [emojiAlias] })
      expect((await emojiRows()).every((e) => e.removed_at !== null)).toBe(true)
    })
  })

  describe('files', () => {
    const fileMessage = (files: Record<string, any>[]) => [{ channel_id: channelId, message_ts: `${nowSec - 100}.000300`, files }]
    const slackFile = (n: number, extra: Record<string, any> = {}) => ({
      id: fileIds[n - 1],
      name: `draft ${n}.txt`,
      mimetype: 'text/plain',
      size: 12,
      url_private_download: `https://files.example.test/${fileIds[n - 1]}`,
      ...extra,
    })
    const okDownload = (calls: string[]) =>
      (async (url: any, init: any) => {
        calls.push(`${url} ${init?.headers?.Authorization}`)
        return new Response('hello hedgie', { status: 200, headers: { 'content-type': 'text/plain' } })
      }) as typeof fetch
    const stored = async (id: string) => {
      const { data } = await bronze('slack_files').select('storage_path, copied_at, copy_error, name, size_bytes').eq('file_id', id).single()
      return data!
    }
    const later = () => fake.clock.now() + 60_000

    it('copies a file into the private bucket, with the bot token, once', async () => {
      const calls: string[] = []
      const now = new Date().toISOString()

      const first = await copySlackFiles(supabase, 'xoxb-test', fileMessage([slackFile(1)]), now, later(), okDownload(calls))

      expect(first).toMatchObject({ seen: 1, copied: 1, skipped: 0, failed: 0, pending: 0 })
      expect(calls).toEqual([`https://files.example.test/${fileIds[0]} Bearer xoxb-test`])
      const row = await stored(fileIds[0])
      expect(row).toMatchObject({ storage_path: `${fileIds[0]}/draft_1.txt`, copy_error: null, name: 'draft 1.txt', size_bytes: 12 })
      expect(row.copied_at).not.toBeNull()
      const { data: blob } = await supabase.storage.from(SLACK_FILES_BUCKET).download(row.storage_path)
      expect(await blob!.text()).toBe('hello hedgie')

      // Seeing the file again doesn't download it again or lose its path.
      const second = await copySlackFiles(supabase, 'xoxb-test', fileMessage([slackFile(1)]), now, later(), okDownload(calls))
      expect(second).toMatchObject({ copied: 0, pending: 0 })
      expect(calls).toHaveLength(1)
      expect((await stored(fileIds[0])).storage_path).toBe(row.storage_path)
    })

    it('marks files it will never copy, without downloading them', async () => {
      const calls: string[] = []
      const files = [
        slackFile(1, { size: MAX_SLACK_FILE_BYTES + 1 }),
        slackFile(2, { mode: 'external', is_external: true }),
        slackFile(3, { mode: 'tombstone' }),
      ]

      const result = await copySlackFiles(supabase, 'xoxb-test', fileMessage(files), new Date().toISOString(), later(), okDownload(calls))

      expect(result).toMatchObject({ seen: 3, copied: 0, skipped: 3, failed: 0, pending: 0 })
      expect(calls).toEqual([])
      expect((await stored(fileIds[0])).copy_error).toBe('skipped: larger than 20 MB')
      expect((await stored(fileIds[1])).copy_error).toBe('skipped: hosted outside Slack')
      expect((await stored(fileIds[2])).copy_error).toBe('skipped: deleted in Slack')
    })

    it('keeps a failed download pending and copies it on a later import', async () => {
      const now = new Date().toISOString()
      const failing = (async () => new Response('nope', { status: 500 })) as typeof fetch
      // Without access, Slack answers 200 with its sign-in page.
      const signInPage = (async () => new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch

      const first = await copySlackFiles(supabase, 'xoxb-test', fileMessage([slackFile(1)]), now, later(), failing)
      expect(first).toMatchObject({ copied: 0, failed: 1, pending: 1 })
      expect((await stored(fileIds[0])).copy_error).toContain('HTTP 500')

      const second = await copySlackFiles(supabase, 'xoxb-test', [], now, later(), signInPage)
      expect(second).toMatchObject({ copied: 0, failed: 1, pending: 1 })
      expect((await stored(fileIds[0])).copy_error).toContain('sign-in page')

      const third = await copySlackFiles(supabase, 'xoxb-test', [], now, later(), okDownload([]))
      expect(third).toMatchObject({ copied: 1, failed: 0, pending: 0 })
      expect(await stored(fileIds[0])).toMatchObject({ storage_path: `${fileIds[0]}/draft_1.txt`, copy_error: null })
    })

    it('stops at its deadline and leaves the rest pending, oldest first', async () => {
      const calls: string[] = []
      const messages = [
        { channel_id: channelId, message_ts: `${nowSec - 50}.000400`, files: [slackFile(2)] },
        { channel_id: channelId, message_ts: `${nowSec - 500}.000100`, files: [slackFile(1)] },
      ]
      const deadline = fake.clock.now() + 1000
      // The first download uses up the time.
      const slowDownload = (async (url: any, init: any) => {
        fake.clock.advance(5000)
        return okDownload(calls)(url, init)
      }) as typeof fetch

      const result = await copySlackFiles(supabase, 'xoxb-test', messages, new Date().toISOString(), deadline, slowDownload)

      expect(result).toMatchObject({ seen: 2, copied: 1, pending: 1 })
      // Our test files sort after any other pending file by message_ts only among themselves:
      // the older message's file is the one that got copied.
      expect((await stored(fileIds[0])).storage_path).not.toBeNull()
      expect((await stored(fileIds[1])).storage_path).toBeNull()
    })
  })
})
