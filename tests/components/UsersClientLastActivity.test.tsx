// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsersClient from '@/app/(admin)/admin/users/UsersClient'

const base = {
  role: 'member', features: [], createdAt: '2026-01-01T00:00:00Z', staffId: null, staffName: null, staffRole: null,
  memberId: null, memberName: null, memberDisplayName: null, aliases: [], pending: false, bannedUntil: null,
}
const users = [
  { ...base, id: 'u1', email: 'never1@example.com', lastActivityAt: null },
  { ...base, id: 'u2', email: 'recent@example.com', lastActivityAt: '2026-11-01T15:00:00Z' },
  { ...base, id: 'u3', email: 'invited@example.com', lastActivityAt: null, pending: true },
  { ...base, id: 'u4', email: 'older@example.com', lastActivityAt: '2026-03-01T15:00:00Z' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ users, allMembers: [] }) } as Response)))
})
afterEach(() => vi.unstubAllGlobals())

function emailsInOrder() {
  const rows = screen.getAllByRole('row').slice(1)
  return rows.map((r) => /([a-z0-9]+@example\.com)/.exec(r.querySelector('td div.text-xs')!.textContent!)![1])
}

describe('UsersClient last activity', () => {
  it('says "Never signed in" for users who never logged in, with a date for the rest', async () => {
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (4)')
    expect(screen.getAllByText('Never signed in')).toHaveLength(2)
    const recent = screen.getByText('recent@example.com').closest('tr')!
    expect(within(recent).queryByText('Never signed in')).toBeNull()
  })

  it('groups the never-signed-in users together at one end in both directions', async () => {
    const user = userEvent.setup()
    render(<UsersClient currentUserId="me" />)
    await screen.findByText('All Users (4)')
    await user.click(screen.getByRole('columnheader', { name: /Last Activity/ }))
    expect(emailsInOrder().slice(0, 2)).toEqual(['older@example.com', 'recent@example.com'])
    await user.click(screen.getByRole('columnheader', { name: /Last Activity/ }))
    const desc = emailsInOrder()
    expect(desc.slice(0, 2).sort()).toEqual(['invited@example.com', 'never1@example.com'])
    expect(desc.slice(2)).toEqual(['recent@example.com', 'older@example.com'])
  })
})
