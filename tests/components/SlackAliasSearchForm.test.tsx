// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SlackAliasSearchForm from '@/app/(admin)/admin/hygiene/unmatched-slack/SlackAliasSearchForm'

const unmatchedSlackUsers = [
  {
    slack_user_id: 'U1',
    email: 'alice@example.com',
    real_name: 'Alice Example',
    display_name: 'alice',
    message_count: 12,
    is_deleted: false,
  },
  {
    slack_user_id: 'U2',
    email: null,
    real_name: 'Bob Guest',
    display_name: null,
    message_count: 3,
    is_deleted: true,
  },
]

const allMembers = [
  { id: 'm1', name: 'Alice Example', email: 'alice@example.com' },
  { id: 'm2', name: 'Charlie Member', email: 'charlie@example.com' },
]

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('SlackAliasSearchForm', () => {
  it('renders a row per unmatched Slack user with name, email, and message count', () => {
    render(<SlackAliasSearchForm unmatchedSlackUsers={unmatchedSlackUsers} allMembers={allMembers} />)

    expect(screen.getByText('Alice Example')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('12 messages')).toBeInTheDocument()

    expect(screen.getByText('Bob Guest')).toBeInTheDocument()
    expect(screen.getByText('3 messages')).toBeInTheDocument()
  })

  it('shows active/deactivated status badges and a breakdown count', () => {
    render(<SlackAliasSearchForm unmatchedSlackUsers={unmatchedSlackUsers} allMembers={allMembers} />)

    const aliceRow = screen.getByText('Alice Example').closest('div.p-3') as HTMLElement
    expect(within(aliceRow).getByText('active')).toBeInTheDocument()

    const bobRow = screen.getByText('Bob Guest').closest('div.p-3') as HTMLElement
    expect(within(bobRow).getByText('deactivated')).toBeInTheDocument()

    expect(screen.getByText('1 active · 1 deactivated')).toBeInTheDocument()
  })

  it('creates an alias and removes the row when a member is selected', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    render(<SlackAliasSearchForm unmatchedSlackUsers={unmatchedSlackUsers} allMembers={allMembers} />)

    const aliceRow = screen.getByText('Alice Example').closest('div.p-3') as HTMLElement
    const searchInput = within(aliceRow).getByPlaceholderText('Search for member...')
    await userEvent.type(searchInput, 'Alice')
    await userEvent.click(within(aliceRow).getByRole('button', { name: /Alice Example/ }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/aliases/slack',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ member_id: 'm1', slack_user_id: 'U1' }),
      })
    )

    await waitFor(() => {
      expect(screen.queryByText('12 messages')).not.toBeInTheDocument()
    })
    // The other row remains
    expect(screen.getByText('Bob Guest')).toBeInTheDocument()
  })

  it('skips a user and removes the row', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    render(<SlackAliasSearchForm unmatchedSlackUsers={unmatchedSlackUsers} allMembers={allMembers} />)

    const bobRow = screen.getByText('Bob Guest').closest('div.p-3') as HTMLElement
    await userEvent.click(within(bobRow).getByText('Skip'))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/data-hygiene/slack-users/skip',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ slack_user_id: 'U2', reason: 'non_member' }),
      })
    )

    await waitFor(() => {
      expect(screen.queryByText('Bob Guest')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Alice Example')).toBeInTheDocument()
  })

  it('shows an error message and keeps the row when the request fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Something went wrong' }),
    })

    render(<SlackAliasSearchForm unmatchedSlackUsers={unmatchedSlackUsers} allMembers={allMembers} />)

    const bobRow = screen.getByText('Bob Guest').closest('div.p-3') as HTMLElement
    await userEvent.click(within(bobRow).getByText('Skip'))

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
    expect(screen.getByText('Bob Guest')).toBeInTheDocument()
  })
})
