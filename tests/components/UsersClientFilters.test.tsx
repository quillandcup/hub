// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsersClient from '@/app/(admin)/admin/users/UsersClient'

const base = {
  role: 'member',
  features: [],
  createdAt: '2026-01-01T00:00:00Z',
  staffId: null,
  staffName: null,
  staffRole: null,
  memberId: null,
  memberName: null,
  memberDisplayName: null,
  aliases: [] as string[],
  pending: false,
  bannedUntil: null,
}

const USERS = [
  { ...base, id: 'u1', email: 'ada@example.test', memberId: 'mbr_AAAAAAAAAAA1', memberName: 'Ada Example', memberDisplayName: 'Penny Quill', aliases: ['AdaZoomName', 'ada.work@example.test'] },
  { ...base, id: 'u2', email: 'bea@example.test', memberId: 'mbr_AAAAAAAAAAA2', memberName: 'Bea Example' },
  { ...base, id: 'u3', email: 'fern@example.test', role: 'admin', staffId: 'stf_AAAAAAAAAAA3', staffName: 'Fern Staff', staffRole: 'staff' },
  { ...base, id: 'u4', email: 'ghost@example.test' },
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ users: USERS, allMembers: [] }) } as Response))
  )
})

afterEach(() => vi.unstubAllGlobals())

const rowCount = () => screen.getAllByRole('row').length - 1 // minus the header row

describe('UsersClient search and filters', () => {
  it('leads each row with the linked profile name and shows the email beneath it', async () => {
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (4)')

    const row = screen.getByText('ada@example.test').closest('tr')!
    expect(within(row).getByText('Penny Quill')).toBeInTheDocument() // display name, not the legal name
    expect(screen.queryByRole('columnheader', { name: /^Email/ })).not.toBeInTheDocument()
    expect(within(screen.getByText('ghost@example.test').closest('tr')!).getByText('No linked profile')).toBeInTheDocument()
  })

  it('splits users into members and staff with the pills, with counts', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (4)')

    const pills = within(screen.getByRole('group', { name: 'Show' }))
    expect(pills.getByRole('button', { name: /^All 4/ })).toHaveAttribute('aria-pressed', 'true')

    await user.click(pills.getByRole('button', { name: /^Staff 1/ }))
    expect(screen.getByText('Staff (1)')).toBeInTheDocument()
    expect(screen.getByText('fern@example.test')).toBeInTheDocument()
    expect(screen.queryByText('ada@example.test')).not.toBeInTheDocument()

    await user.click(pills.getByRole('button', { name: /^Members 3/ }))
    expect(screen.getByText('Members (3)')).toBeInTheDocument()
    expect(screen.queryByText('fern@example.test')).not.toBeInTheDocument()
    expect(rowCount()).toBe(3)
  })

  it('searches by email, legal name, display name and staff name, within the chosen pill', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (4)')
    const search = screen.getByRole('searchbox', { name: 'Search users' })

    await user.type(search, 'penny')
    expect(rowCount()).toBe(1)
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'ada example') // the legal name still finds them
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'fern staff')
    expect(screen.getByText('All Users (1)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Members/ }))
    expect(screen.getByText('Members (0)')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'ghost@')
    expect(screen.getByText('ghost@example.test')).toBeInTheDocument()
  })

  it('finds a person by an alias of their linked member: a Zoom or Slack name, or an extra email', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (4)')
    const search = screen.getByRole('searchbox', { name: 'Search users' })

    await user.type(search, 'adazoom')
    expect(screen.getByText('All Users (1)')).toBeInTheDocument()
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'ada.work@')
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()
  })
})
