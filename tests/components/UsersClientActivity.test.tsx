// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsersClient from '@/app/(admin)/admin/users/UsersClient'

const USER = {
  id: 'u1',
  email: 'moss@example.test',
  role: 'member',
  features: [],
  createdAt: '2026-01-01T00:00:00Z',
  staffName: null,
  staffRole: null,
  memberId: null,
  memberName: null,
  pending: false,
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/access-history')
        ? jsonResponse({
            sessions: [
              {
                session_start: '2026-10-01T12:00:00Z',
                session_end: '2026-10-01T12:30:00Z',
                event_count: 3,
                pages: ['/dashboard', '/my-prickles', '/my-prickles'],
                auth_session_id: null,
                session_active: false,
                auth_session_created_at: null,
                device: null,
                user_agent:
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile Safari/604.1',
              },
            ],
          })
        : jsonResponse({ users: [USER], allMembers: [] })
    )
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('UsersClient activity modal', () => {
  it('groups a visit by place with counts and keeps the raw order behind a toggle', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await user.click(await screen.findByRole('button', { name: 'Activity' }))

    expect(await screen.findByText('My Prickles')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('In order')).toBeInTheDocument()
  })

  it("shows the device each visit came from", async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await user.click(await screen.findByRole('button', { name: 'Activity' }))

    expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument()
  })

  it("still shows the device once the raw user agent has been removed, from the one stored with the visit", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/access-history')
          ? jsonResponse({
              sessions: [
                {
                  session_start: '2026-10-01T12:00:00Z',
                  session_end: '2026-10-01T12:30:00Z',
                  event_count: 1,
                  pages: ['/dashboard'],
                  auth_session_id: null,
                  session_active: false,
                  auth_session_created_at: null,
                  user_agent: null,
                  device: { browser: 'Firefox', browser_version: '127.0', os: 'Windows', os_version: null, device_type: 'desktop' },
                },
              ],
            })
          : jsonResponse({ users: [USER], allMembers: [] })
      )
    )
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await user.click(await screen.findByRole('button', { name: 'Activity' }))

    expect(await screen.findByText('Firefox on Windows')).toBeInTheDocument()
  })
})
