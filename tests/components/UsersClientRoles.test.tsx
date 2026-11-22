// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import UsersClient from '@/app/(admin)/admin/users/UsersClient'

const base = {
  role: 'member',
  features: [] as string[],
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
  { ...base, id: 'u1', email: 'ada@example.test', role: 'community_manager', roles: ['community_manager', 'conversion_specialist'] },
  { ...base, id: 'u2', email: 'bea@example.test' },
  { ...base, id: 'u3', email: 'old@example.test', role: 'assistant' }, // an older response with only `role`
]

const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  void url
  void init
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: USERS, allMembers: [], success: true }) } as Response)
})

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const rowOf = (email: string) => screen.getByText(email).closest('tr')!

describe('UsersClient roles', () => {
  it('shows every role a person holds, Member for none, and reads a response that has only `role`', async () => {
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (3)')

    const ada = within(rowOf('ada@example.test'))
    expect(ada.getByText('Community Manager')).toBeInTheDocument()
    expect(ada.getByText('Conversion Specialist')).toBeInTheDocument()
    expect(within(rowOf('bea@example.test')).getByText('Member')).toBeInTheDocument()
    expect(within(rowOf('old@example.test')).getByText('Assistant')).toBeInTheDocument()
  })

  it('counts a person holding any role as staff', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (3)')
    await user.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: /^Staff 2/ }))
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()
    expect(screen.queryByText('bea@example.test')).not.toBeInTheDocument()
  })

  it('edits the set with checkboxes and saves the list of roles, highest priority first', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (3)')

    await user.click(within(rowOf('bea@example.test')).getByRole('button', { name: /edit/i }))
    const roles = within(screen.getByRole('group', { name: 'Roles' }))
    expect(roles.getByRole('checkbox', { name: 'Admin' })).not.toBeChecked()
    expect(screen.getByText('No role: a member.')).toBeInTheDocument()

    await user.click(roles.getByRole('checkbox', { name: 'Conversion Specialist' }))
    await user.click(roles.getByRole('checkbox', { name: 'Community Manager' }))
    expect(screen.getByText('They may do whatever any of their roles allows.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/admin/users/u2')
    expect(JSON.parse(patch[1]!.body as string)).toMatchObject({ roles: ['community_manager', 'conversion_specialist'] })
  })

  it('starts the edit from the roles held, and can clear them all', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (3)')

    await user.click(within(rowOf('ada@example.test')).getByRole('button', { name: /edit/i }))
    const roles = within(screen.getByRole('group', { name: 'Roles' }))
    expect(roles.getByRole('checkbox', { name: 'Community Manager' })).toBeChecked()
    expect(roles.getByRole('checkbox', { name: 'Conversion Specialist' })).toBeChecked()
    expect(roles.getByRole('checkbox', { name: 'Assistant' })).not.toBeChecked()

    await user.click(roles.getByRole('checkbox', { name: 'Community Manager' }))
    await user.click(roles.getByRole('checkbox', { name: 'Conversion Specialist' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(JSON.parse(patch[1]!.body as string).roles).toEqual([])
  })
})
