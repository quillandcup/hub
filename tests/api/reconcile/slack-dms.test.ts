import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/reconcile/slack-dms/route'

vi.mock('@/lib/chat/slack-dms', () => ({ pullDmsForCoveredMembers: vi.fn() }))
vi.mock('@/lib/chat/slack-post', () => ({ chatSlackWritesEnabled: vi.fn(() => true) }))
vi.mock('@/lib/supabase/api-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/cron-heartbeats', () => ({ pingCronHeartbeat: vi.fn() }))
vi.mock('@/lib/operations-alerts', () => ({ sendOperationsAlert: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/data/repos', () => ({ createRepos: vi.fn(() => ({})) }))

import { pullDmsForCoveredMembers } from '@/lib/chat/slack-dms'
import { chatSlackWritesEnabled } from '@/lib/chat/slack-post'
import { sendOperationsAlert } from '@/lib/operations-alerts'
import { requireAdmin } from '@/lib/supabase/api-auth'
import { pingCronHeartbeat } from '@/lib/cron-heartbeats'

const request = () => new Request('http://localhost:3000/api/reconcile/slack-dms') as unknown as NextRequest
const clean = { members: 3, conversations: 9, messages: 40, deferred: 0, errors: [] as string[] }

describe('GET /api/reconcile/slack-dms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(chatSlackWritesEnabled).mockReturnValue(true)
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'service-role' } as any, forbidden: false, supabase: {} as any })
    vi.mocked(pullDmsForCoveredMembers).mockResolvedValue(clean)
  })

  it('answers 401 when unauthenticated and 403 when not an admin, and pulls nothing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null, forbidden: false, supabase: {} as any })
    expect((await GET(request())).status).toBe(401)
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'u' } as any, forbidden: true, supabase: {} as any })
    expect((await GET(request())).status).toBe(403)
    expect(pullDmsForCoveredMembers).not.toHaveBeenCalled()
  })

  it('pulls with a deadline inside the function time, returns the result and pings the heartbeat', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, reconciliation: 'slack-dms', ...clean })
    const { deadline } = vi.mocked(pullDmsForCoveredMembers).mock.calls[0][1]
    expect(deadline - Date.now()).toBeGreaterThan(100_000)
    expect(deadline - Date.now()).toBeLessThan(300_000)
    expect(pingCronHeartbeat).toHaveBeenCalledWith('reconcile-slack-dms')
    expect(sendOperationsAlert).not.toHaveBeenCalled()
  })

  it('does nothing off production, and does not ping the heartbeat (nothing ran)', async () => {
    vi.mocked(chatSlackWritesEnabled).mockReturnValue(false)
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ skipped: 'not production' })
    expect(pullDmsForCoveredMembers).not.toHaveBeenCalled()
    expect(pingCronHeartbeat).not.toHaveBeenCalled()
  })

  it('alerts instead of pinging when a DM failed or members were left for the next run', async () => {
    vi.mocked(pullDmsForCoveredMembers).mockResolvedValue({ ...clean, deferred: 2, errors: ['member x: boom'] })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(sendOperationsAlert).toHaveBeenCalledWith({}, {
      type: 'cron_partial_failure',
      job: 'reconcile-slack-dms',
      problems: ["2 members' DMs left for the next run: out of time", 'member x: boom'],
    })
    expect(pingCronHeartbeat).not.toHaveBeenCalled()
  })

  it('alerts and answers 500 when the run fails outright', async () => {
    vi.mocked(pullDmsForCoveredMembers).mockRejectedValue(new Error('db down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'db down' })
    expect(sendOperationsAlert).toHaveBeenCalledWith({}, expect.objectContaining({ job: 'reconcile-slack-dms', problems: ['failed outright: db down'] }))
    error.mockRestore()
  })
})
