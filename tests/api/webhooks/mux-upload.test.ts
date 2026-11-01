import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { InMemoryDataset } from '@/lib/data/in-memory'
import { createInMemoryRepos } from '@/lib/data/repos'
import { courseRow, lessonRow, videoRow } from '../../helpers/course-fixtures'

/**
 * The Mux webhook for videos uploaded from the browser: the upload event tells the video row which asset Mux made,
 * and a ready asset gives its length to the Hub-owned lessons that use it. The repositories are the in-memory twins.
 */

const SECRET = 'test-mux-webhook-secret'
let repos = createInMemoryRepos()
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/lib/data/repos', async () => ({
  ...(await vi.importActual<typeof import('@/lib/data/repos')>('@/lib/data/repos')),
  createRepos: () => repos,
}))

import { POST } from '@/app/api/webhooks/mux/route'

function signedRequest(body: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')
  return new Request('http://localhost:3000/api/webhooks/mux', { method: 'POST', headers: { 'mux-signature': `t=${timestamp},v1=${v1}` }, body }) as unknown as NextRequest
}

const COURSE = 'crs_AAAAAAAAAAA1'
const KAJABI_COURSE = 'crs_AAAAAAAAAAA2'
const VIDEO = '00000000-0000-4000-a000-000000000001'
const HUB_LESSON = 'les_AAAAAAAAAAA1'
const KAJABI_LESSON = 'les_AAAAAAAAAAA2'

const uploaded = { type: 'video.upload.asset_created', data: { id: 'upload-1', asset_id: 'asset-1' } }
const ready = { type: 'video.asset.ready', data: { id: 'asset-1', duration: 61.6, playback_ids: [{ id: 'signed-pb', policy: 'signed' }] } }

beforeEach(() => {
  vi.stubEnv('MUX_WEBHOOK_SECRET', SECRET)
  repos = createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: 'hub', title: 'Hub' }), courseRow({ id: KAJABI_COURSE, slug: 'kajabi', title: 'Kajabi', source: 'kajabi', source_key: 'k1' })],
      videos: [videoRow({ id: VIDEO, source_kind: 'upload', source_key: 'upload-1' })],
      courseLessons: [
        lessonRow({ id: HUB_LESSON, course_id: COURSE, title: 'Hub lesson', video_id: VIDEO }),
        lessonRow({ id: KAJABI_LESSON, course_id: KAJABI_COURSE, title: 'Kajabi lesson', source: 'kajabi', source_key: 'kl1', video_id: VIDEO }),
      ],
    }),
  )
})

describe('Mux webhook, uploads from the browser', () => {
  it('records the asset Mux made on the video row of that upload', async () => {
    const response = await POST(signedRequest(JSON.stringify(uploaded)))

    expect(response.status).toBe(200)
    expect((await response.json()).processed).toBe(true)
    expect((await repos.courses.videosByIds([VIDEO]))[0].mux_asset_id).toBe('asset-1')
  })

  it('acknowledges an upload nobody here started, without recording anything', async () => {
    const response = await POST(signedRequest(JSON.stringify({ type: 'video.upload.asset_created', data: { id: 'someone-elses', asset_id: 'asset-9' } })))

    expect(response.status).toBe(200)
    expect((await response.json()).processed).toBe(false)
    expect((await repos.courses.videosByIds([VIDEO]))[0].mux_asset_id).toBeNull()
  })

  it('answers 500 so Mux retries when the row cannot be updated', async () => {
    vi.spyOn(repos.courses, 'updateVideo').mockRejectedValueOnce(new Error('boom'))
    const response = await POST(signedRequest(JSON.stringify(uploaded)))

    expect(response.status).toBe(500)
  })

  it("gives a ready asset's length, in whole seconds, to the Hub-owned lesson that uses it and not to an imported lesson", async () => {
    await POST(signedRequest(JSON.stringify(uploaded)))
    const response = await POST(signedRequest(JSON.stringify(ready)))

    expect(response.status).toBe(200)
    expect((await repos.courses.videosByIds([VIDEO]))[0]).toMatchObject({ status: 'ready', mux_playback_id: 'signed-pb', duration_seconds: 61.6 })
    expect((await repos.courses.lessonById(HUB_LESSON))?.duration_seconds).toBe(62)
    expect((await repos.courses.lessonById(KAJABI_LESSON))?.duration_seconds).toBeNull()
  })

  it("leaves lessons' lengths alone when the asset failed", async () => {
    await POST(signedRequest(JSON.stringify(uploaded)))
    await POST(signedRequest(JSON.stringify({ type: 'video.asset.errored', data: { id: 'asset-1' } })))

    expect((await repos.courses.videosByIds([VIDEO]))[0].status).toBe('errored')
    expect((await repos.courses.lessonById(HUB_LESSON))?.duration_seconds).toBeNull()
  })
})
