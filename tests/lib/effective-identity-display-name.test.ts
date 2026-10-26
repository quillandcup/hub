import { describe, it, expect, vi, beforeEach } from 'vitest'

const byUserId = vi.fn()
const byEmail = vi.fn()
const byId = vi.fn()

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/data/repos', () => ({ createRepos: () => ({ members: { byUserId, byEmail, byId } }) }))

import { getEffectiveIdentity } from '@/lib/sudo'

const member = (displayName: string | null) => ({
  id: 'mbr_AAAAAAAAAAA1',
  name: 'Ada Example Lovelace',
  displayName,
  email: 'ada@example.com',
})

describe('getEffectiveIdentity display name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    byEmail.mockResolvedValue(null)
  })

  it('carries the chosen display name next to the legal name', async () => {
    byUserId.mockResolvedValue(member('Ada E.'))
    const identity = await getEffectiveIdentity({ id: 'user-1', email: 'ada@example.com' })
    expect(identity?.memberName).toBe('Ada Example Lovelace')
    expect(identity?.memberDisplayName).toBe('Ada E.')
  })

  it('falls back to the legal name when no display name is set', async () => {
    byUserId.mockResolvedValue(member('  '))
    const identity = await getEffectiveIdentity({ id: 'user-2', email: 'ada@example.com' })
    expect(identity?.memberDisplayName).toBe('Ada Example Lovelace')
  })
})
