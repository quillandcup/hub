// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsersClient from '@/app/(admin)/admin/users/UsersClient'

const allMembers = [
  { id: 'm1', name: 'Alice Author', email: 'alice@example.com', user_id: null },
  { id: 'm2', name: 'Bob Linked', email: 'bob@example.com', user_id: 'u-bob' },
]

let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)
}

beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/admin/users' && init?.method === 'POST') {
      return jsonResponse({ user: { id: 'new', email: 'x' } })
    }
    return jsonResponse({ users: [], allMembers })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function postedBodies() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(init!.body as string))
}

async function openInviteForm() {
  const user = userEvent.setup()
  render(<UsersClient currentUserId="me" />)
  await screen.findByText('All Users (0)')
  await user.click(screen.getByRole('button', { name: '+ Invite User' }))
  return user
}

describe('UsersClient invite form', () => {
  it('invites the email of the member picked from the member search', async () => {
    const user = await openInviteForm()
    const send = screen.getByRole('button', { name: 'Send Invite' })
    expect(send).toBeDisabled()

    await user.type(screen.getByPlaceholderText('Search members by name or email...'), 'ali')
    await user.click(await screen.findByRole('button', { name: /Alice Author/ }))

    // Picking an option selects it without submitting the form
    expect(postedBodies()).toEqual([])
    expect(screen.getByText('Alice Author')).toBeInTheDocument()

    await user.click(send)
    await waitFor(() => expect(postedBodies()).toEqual([{ email: 'alice@example.com' }]))
  })

  it('only offers members not already linked to a user', async () => {
    const user = await openInviteForm()
    await user.type(screen.getByPlaceholderText('Search members by name or email...'), 'example.com')
    expect(await screen.findByRole('button', { name: /Alice Author/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bob Linked/ })).not.toBeInTheDocument()
  })

  it('can still invite a non-member by email', async () => {
    const user = await openInviteForm()
    await user.click(screen.getByRole('button', { name: 'Invite by email instead' }))
    await user.type(screen.getByPlaceholderText('user@example.com'), 'staff@example.com')
    await user.click(screen.getByRole('button', { name: 'Send Invite' }))
    await waitFor(() => expect(postedBodies()).toEqual([{ email: 'staff@example.com' }]))
  })
})
