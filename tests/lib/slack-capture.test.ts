import { describe, it, expect } from 'vitest'
import {
  MAX_SLACK_FILE_BYTES,
  slackChannelType,
  slackFileSkipReason,
  slackFileStoragePath,
  slackFilesFromMessages,
  toCustomEmojiRow,
  toSlackChannelRow,
} from '@/lib/slack-capture'

describe('toSlackChannelRow / slackChannelType', () => {
  it('maps a public channel, a private channel and a group DM', () => {
    const pub = toSlackChannelRow({ id: 'C1', name: 'general', created: 1_700_000_000, num_members: 12, topic: { value: 'hi' } })
    expect(pub).toMatchObject({ channel_id: 'C1', is_private: false, is_mpim: false, member_count: 12, topic: 'hi', purpose: null })
    expect(slackChannelType(pub)).toBe('public_channel')

    expect(slackChannelType(toSlackChannelRow({ id: 'G1', name: 'huddle', is_private: true }))).toBe('private_channel')

    // Slack marks group DMs is_mpim; they are always private.
    const mpim = toSlackChannelRow({ id: 'G2', name: 'mpdm-fern--bramble-1', is_mpim: true })
    expect(mpim).toMatchObject({ is_private: true, is_mpim: true })
    expect(slackChannelType(mpim)).toBe('mpim')
  })
})

describe('toCustomEmojiRow', () => {
  it('splits an image from an alias', () => {
    expect(toCustomEmojiRow('hedgie', 'https://emoji.example.test/hedgie.png')).toEqual({
      name: 'hedgie',
      image_url: 'https://emoji.example.test/hedgie.png',
      alias_for: null,
      deleted_at: null,
    })
    expect(toCustomEmojiRow('hog', 'alias:hedgie')).toEqual({ name: 'hog', image_url: null, alias_for: 'hedgie', deleted_at: null })
  })
})

describe('slackFilesFromMessages', () => {
  it('returns one row per file, from the first message it appears on', () => {
    const file = { id: 'F1', name: 'draft.pdf', mimetype: 'application/pdf', size: 99 }
    const rows = slackFilesFromMessages([
      { channel_id: 'C1', message_ts: '1.000100', files: [file, { id: 'F2', title: 'Untitled' }] },
      { channel_id: 'C2', message_ts: '2.000100', files: [file] },
      { channel_id: 'C2', message_ts: '3.000100', files: null },
      { channel_id: 'C2', message_ts: '4.000100' },
    ])
    expect(rows.map((r) => [r.file_id, r.channel_id, r.message_ts, r.name, r.size_bytes])).toEqual([
      ['F1', 'C1', '1.000100', 'draft.pdf', 99],
      ['F2', 'C1', '1.000100', 'Untitled', null],
    ])
  })
})

describe('slackFileSkipReason', () => {
  const file = (raw: Record<string, unknown>, size: number | null = 10) => ({ size_bytes: size, raw_payload: raw })

  it('copies an ordinary Slack-hosted file', () => {
    expect(slackFileSkipReason(file({ url_private: 'https://files.slack.com/x' }))).toBeNull()
    expect(slackFileSkipReason(file({ url_private_download: 'https://files.slack.com/x' }, MAX_SLACK_FILE_BYTES))).toBeNull()
  })

  it('never copies deleted, hidden, external, URL-less or oversized files', () => {
    expect(slackFileSkipReason(file({ mode: 'tombstone' }))).toMatch(/^skipped: deleted/)
    expect(slackFileSkipReason(file({ mode: 'hidden_by_limit' }))).toMatch(/^skipped: hidden/)
    expect(slackFileSkipReason(file({ mode: 'external', url_private: 'https://drive.example.test' }))).toMatch(/^skipped: hosted outside/)
    expect(slackFileSkipReason(file({}))).toMatch(/^skipped: no download URL/)
    expect(slackFileSkipReason(file({ url_private: 'https://files.slack.com/x' }, MAX_SLACK_FILE_BYTES + 1))).toMatch(/^skipped: larger/)
  })
})

describe('slackFileStoragePath', () => {
  it('keys by file id and keeps a safe version of the name', () => {
    expect(slackFileStoragePath({ file_id: 'F1', name: 'My Draft (final).pdf' })).toBe('F1/My_Draft_final_.pdf')
    expect(slackFileStoragePath({ file_id: 'F2', name: null })).toBe('F2/file')
    expect(slackFileStoragePath({ file_id: 'F3', name: '../../etc/passwd' })).toBe('F3/.._.._etc_passwd')
  })
})
