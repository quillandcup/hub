// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import UsersClient from '@/app/(admin)/admin/users/UsersClient'

const USER = {
  id: 'u1',
  email: 'moss@example.test',
  role: 'admin',
  features: [],
  createdAt: '2026-01-01T00:00:00Z',
  staffId: 'stf_AAAAAAAAAAA1',
  staffName: 'Moss Example',
  staffRole: 'owner',
  memberId: 'mbr_AAAAAAAAAAA1',
  memberName: 'Moss Example',
  pending: false,
}

afterEach(() => vi.unstubAllGlobals())

describe('UsersClient history icons', () => {
  it('puts a history button beside the staff badge and another beside the member badge', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ users: [USER], allMembers: [] }) } as Response)))
    render(<UsersClient currentUserId="me" />)
    const staffBadge = await screen.findByText(/Moss Example · Owner/)
    const memberLink = screen.getByText(/Member: Moss Example/)
    expect(staffBadge.parentElement!.querySelector('button')).not.toBeNull()
    expect(memberLink.parentElement!.querySelector('button')).not.toBeNull()
  })
})
