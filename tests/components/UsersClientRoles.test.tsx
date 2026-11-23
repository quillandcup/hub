// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

let viewerRoles: string[] | undefined = ['admin']

const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  void url
  void init
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: USERS, viewerRoles, allMembers: [], success: true }) } as Response)
})

beforeEach(() => {
  viewerRoles = ['admin']
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

  describe('who may change which role', () => {
    const ADMINS = [
      { ...base, id: 'a1', email: 'boss@example.test', role: 'admin', roles: ['admin'] },
      { ...base, id: 'a2', email: 'boss2@example.test', role: 'admin', roles: ['admin'] },
      { ...base, id: 's1', email: 'helper@example.test', role: 'assistant', roles: ['assistant'] },
      { ...base, id: 'm1', email: 'plain@example.test' },
    ]

    async function openEditor(email: string, as: string[], me = 'me') {
      viewerRoles = as
      fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ users: ADMINS, viewerRoles, allMembers: [] }) } as Response))
      const user = userEvent.setup()
      render(<UsersClient currentUserId={me} />)
      await screen.findByText('All Users (4)')
      await user.click(within(rowOf(email)).getByRole('button', { name: /edit/i }))
      return within(screen.getByRole('group', { name: 'Roles' }))
    }

    it('lets an assistant flip only community manager and conversion specialist on a member', async () => {
      const roles = await openEditor('plain@example.test', ['assistant'])
      expect(roles.getByRole('checkbox', { name: 'Community Manager' })).toBeEnabled()
      expect(roles.getByRole('checkbox', { name: 'Conversion Specialist' })).toBeEnabled()
      expect(roles.getByRole('checkbox', { name: 'Admin' })).toBeDisabled()
      expect(roles.getByRole('checkbox', { name: 'Assistant' })).toBeDisabled()
    })

    it('disables every box, and says why, for an assistant looking at an admin or another assistant', async () => {
      let roles = await openEditor('boss@example.test', ['assistant'])
      for (const name of ['Admin', 'Assistant', 'Community Manager', 'Conversion Specialist']) expect(roles.getByRole('checkbox', { name })).toBeDisabled()
      expect(screen.getByText("An assistant can't change the roles of an admin or another assistant.")).toBeInTheDocument()
      cleanup()
      roles = await openEditor('helper@example.test', ['assistant'])
      expect(roles.getByRole('checkbox', { name: 'Community Manager' })).toBeDisabled()
    })

    it('hides Delete for what an assistant may not remove, and keeps it for a member', async () => {
      viewerRoles = ['assistant']
      fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ users: ADMINS, viewerRoles, allMembers: [] }) } as Response))
      render(<UsersClient currentUserId="me" />)
      await screen.findByText('All Users (4)')
      expect(within(rowOf('boss@example.test')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
      expect(within(rowOf('helper@example.test')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
      expect(within(rowOf('plain@example.test')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    })

    it("lets an admin flip everything on someone else, but not their own admin box", async () => {
      let roles = await openEditor('boss2@example.test', ['admin'], 'a1')
      expect(roles.getByRole('checkbox', { name: 'Admin' })).toBeEnabled()
      expect(roles.getByRole('checkbox', { name: 'Assistant' })).toBeEnabled()
      cleanup()
      roles = await openEditor('boss@example.test', ['admin'], 'a1')
      expect(roles.getByRole('checkbox', { name: 'Admin' })).toBeDisabled()
      expect(roles.getByRole('checkbox', { name: 'Assistant' })).toBeEnabled()
    })
  })
})
