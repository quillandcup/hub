import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { POST } from '@/app/api/webhooks/slack/route'
import { removeFilesGoneFromSlack } from '@/lib/chat/file-cleanup'

/**
 * A file deleted in Slack: the webhook (file_deleted) and the nightly import (tombstones and edited
 * messages in the fetched history) both soft-delete the Bronze row and remove our copy. Both are
 * idempotent: running either again changes nothing.
 */
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (callback: () => void | Promise<void>) => void callback() }
})
vi.mock('@/lib/processing/trigger', () => ({ triggerReprocessing: vi.fn(() => Promise.resolve({ processed: [] })) }))

const suffix = Date.now()
const channelId = `CFILEDEL${suffix}`
const fileIds = [1, 2, 3].map((n) => `FDEL${suffix}${n}`)
const ts = (n: number) => `${1_800_000_000 + n}.000100`
const supabase = getTestSupabaseAdminClient()
const bucket = () => supabase.storage.from('slack-files')
const table = () => supabase.schema('bronze').from('slack_files')

async function send(event: Record<string, unknown>) {
  const body = JSON.stringify({ type: 'event_callback', event })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = 'v0=' + createHmac('sha256', 'test-slack-secret').update(`v0:${timestamp}:${body}`).digest('hex')
  const response = await POST(
    new Request('http://localhost:3000/api/webhooks/slack', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', 'x-slack-signature': signature, 'x-slack-request-timestamp': timestamp }),
      body,
    }) as unknown as NextRequest
  )
  expect(response.status).toBe(200)
}

async function seed() {
  for (const [i, id] of fileIds.entries()) {
    const path = `${id}/a.txt`
    const { error: upErr } = await bucket().upload(path, new Blob(['x']), { upsert: true })
    if (upErr) throw upErr
    const { error } = await table().upsert({
      file_id: id, channel_id: channelId, message_ts: ts(i), name: 'a.txt', storage_path: path, copied_at: new Date().toISOString(), raw_payload: { id },
    })
    if (error) throw error
  }
}

async function state(id: string) {
  const { data } = await table().select('deleted_at, copy_error, storage_path').eq('file_id', id).single()
  const { data: listed } = await bucket().list(id)
  return { deleted: !!data?.deleted_at, copyError: data?.copy_error, storagePath: data?.storage_path, bytes: (listed ?? []).length }
}

const cleanup = async () => {
  await bucket().remove(fileIds.map((id) => `${id}/a.txt`))
  await table().delete().eq('channel_id', channelId)
}

describe('Slack file deletion', () => {
  beforeEach(async () => {
    process.env.SLACK_SIGNING_SECRET = 'test-slack-secret'
    await cleanup()
    await seed()
  })
  afterAll(cleanup)

  it('file_deleted soft-deletes the row and removes the bytes, and is safe to repeat', async () => {
    await send({ type: 'file_deleted', file_id: fileIds[0], event_ts: `${suffix}.1` })
    await send({ type: 'file_deleted', file_id: fileIds[0], event_ts: `${suffix}.1` })
    expect(await state(fileIds[0])).toEqual({ deleted: true, copyError: 'skipped: deleted', storagePath: null, bytes: 0 })
    expect((await state(fileIds[1])).bytes).toBe(1)
  })

  it('ignores a file_deleted for a file we never stored or without an id', async () => {
    await send({ type: 'file_deleted', file_id: `FNEVER${suffix}` })
    await send({ type: 'file_deleted' })
    expect((await state(fileIds[0])).deleted).toBe(false)
  })

  it('the nightly import cleans up tombstoned and edited-away files once, and leaves live ones', async () => {
    const messages = [
      { channel_id: channelId, message_ts: ts(0), files: [{ id: fileIds[0], mode: 'tombstone' }] },
      { channel_id: channelId, message_ts: ts(1), files: [] },
      { channel_id: channelId, message_ts: ts(2), files: [{ id: fileIds[2], name: 'a.txt' }] },
    ]
    const first = await removeFilesGoneFromSlack(supabase, messages)
    expect(first).toEqual({ gone: 2, removed: 2, failed: 0 })
    expect(await state(fileIds[0])).toMatchObject({ deleted: true, bytes: 0 })
    expect(await state(fileIds[1])).toMatchObject({ deleted: true, bytes: 0 })
    expect(await state(fileIds[2])).toMatchObject({ deleted: false, bytes: 1 })

    expect((await removeFilesGoneFromSlack(supabase, messages)).gone).toBe(0)
  })
})
