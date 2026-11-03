import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The route calls next/server's after() to defer the Slack notification past
// the response. after() requires a real request-scope context set up by the
// Next.js server runtime, which doesn't exist when a test imports and calls
// the route handler directly (no actual HTTP request is ever made). Mock it
// to just run the callback immediately, matching the convention already used
// in tests/api/webhooks/calendar.test.ts, zoom.test.ts, and slack.test.ts.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void callback()
    },
  }
})

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/sudo', () => ({ getEffectiveIdentity: vi.fn() }))
vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    filesUploadV2: vi.fn().mockResolvedValue({}),
    chat: { postMessage: vi.fn().mockResolvedValue({}) },
  })),
}))

import { POST } from '@/app/api/feedback/route'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveIdentity } from '@/lib/sudo'

function makeSupabaseMock(user: any, insertResult: { data: any; error: any }) {
  const tableApi = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(insertResult),
  }
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({
        data: user ? { claims: { sub: user.id, email: user.email } } : null,
        error: null,
      }) },
    storage: {
      from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }) }),
    },
    from: vi.fn().mockReturnValue(tableApi),
  }
}

function makeFormRequest(fields: Record<string, string>): NextRequest {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) formData.set(key, value)
  return new NextRequest('http://localhost/api/feedback', { method: 'POST', body: formData })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/feedback', () => {
  it('returns 401 when there is no session', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock(null, { data: null, error: null }) as any)

    const res = await POST(
      makeFormRequest({ message: 'broken chart', feedback_type: 'bug', page_url: 'http://x/y' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for an unrecognized feedback_type', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ id: 'u1', email: 'a@b.com' }, { data: null, error: null }) as any
    )

    const res = await POST(
      makeFormRequest({ message: 'hi', feedback_type: 'not-a-type', page_url: 'http://x/y' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when the message is blank', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ id: 'u1', email: 'a@b.com' }, { data: null, error: null }) as any
    )

    const res = await POST(
      makeFormRequest({ message: '   ', feedback_type: 'idea', page_url: 'http://x/y' })
    )
    expect(res.status).toBe(400)
  })

  it('saves a row with member_id null when no member record resolves', async () => {
    const supabase = makeSupabaseMock(
      { id: 'u1', email: 'a@b.com' },
      { data: { id: 'f1', user_id: 'u1' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null)

    const res = await POST(
      makeFormRequest({ message: 'love this', feedback_type: 'idea', page_url: 'http://x/y' })
    )
    expect(res.status).toBe(200)

    const tableApi = supabase.from.mock.results[0].value
    const insertedRow = tableApi.insert.mock.calls[0][0]
    expect(insertedRow.member_id).toBeNull()
    expect(insertedRow.is_sudo).toBe(false)
    expect(insertedRow.user_id).toBe('u1')
  })

  it('attributes feedback to the real user while recording the sudo member', async () => {
    const supabase = makeSupabaseMock(
      { id: 'admin-1', email: 'admin@x.com' },
      { data: { id: 'f2', user_id: 'admin-1' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: 'member-1',
      memberName: 'Alice',
      memberEmail: 'alice@x.com',
      isSudo: true,
    })

    await POST(makeFormRequest({ message: 'typo here', feedback_type: 'bug', page_url: 'http://x/y' }))

    const tableApi = supabase.from.mock.results[0].value
    const insertedRow = tableApi.insert.mock.calls[0][0]
    expect(insertedRow.user_id).toBe('admin-1')
    expect(insertedRow.member_id).toBe('member-1')
    expect(insertedRow.is_sudo).toBe(true)
  })

  it('puts the submission on the member timeline, with the feedback type and id but not the message', async () => {
    const supabase = makeSupabaseMock(
      { id: 'u1', email: 'a@b.com' },
      { data: { id: 'f3', user_id: 'u1' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: 'member-1', memberName: 'Alice', memberEmail: 'alice@x.com', isSudo: false })

    const res = await POST(makeFormRequest({ message: 'my private words', feedback_type: 'idea', page_url: 'http://x/y' }))
    expect(res.status).toBe(200)

    const tableApi = supabase.from.mock.results[0].value
    const activity = tableApi.insert.mock.calls.map((c: any[]) => c[0]).find((row: any) => row?.activity_type === 'feedback_submitted')
    expect(activity).toMatchObject({ member_id: 'member-1', activity_type: 'feedback_submitted', source: 'feedback', related_id: 'f3', actor_kind: 'member' })
    expect(activity.title).toBe('Sent feedback: idea')
    expect(JSON.stringify(activity)).not.toContain('my private words')
  })

  it('records a sudo submission as staff acting for the member', async () => {
    const supabase = makeSupabaseMock(
      { id: 'admin-1', email: 'admin@x.com' },
      { data: { id: 'f4', user_id: 'admin-1' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: 'member-1', memberName: 'Alice', memberEmail: 'alice@x.com', isSudo: true })

    await POST(makeFormRequest({ message: 'typo', feedback_type: 'bug', page_url: 'http://x/y' }))

    const tableApi = supabase.from.mock.results[0].value
    const activity = tableApi.insert.mock.calls.map((c: any[]) => c[0]).find((row: any) => row?.activity_type === 'feedback_submitted')
    expect(activity).toMatchObject({ actor_kind: 'staff', actor_user_id: 'admin-1' })
  })

  it('leaves no timeline entry for an admin without a member record, and still saves the feedback', async () => {
    const supabase = makeSupabaseMock({ id: 'admin-2', email: 'admin2@x.com' }, { data: { id: 'f5', user_id: 'admin-2' }, error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null)

    const res = await POST(makeFormRequest({ message: 'hi', feedback_type: 'idea', page_url: 'http://x/y' }))
    expect(res.status).toBe(200)
    const tableApi = supabase.from.mock.results[0].value
    expect(tableApi.insert.mock.calls.some((c: any[]) => c[0]?.activity_type === 'feedback_submitted')).toBe(false)
  })
})
