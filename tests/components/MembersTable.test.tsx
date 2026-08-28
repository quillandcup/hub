// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MembersTable, { type MemberRow } from '@/app/(admin)/admin/members/MembersTable'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const members: MemberRow[] = [
  {
    id: 'c',
    name: 'Carol',
    email: 'carol@example.com',
    status: 'active',
    member_metrics: {
      last_attended_at: '2024-03-01',
      prickles_last_30_days: 1,
      total_prickles: 5,
      engagement_score: 20,
    },
    member_engagement: { risk_level: 'low', engagement_tier: 'casual' },
  },
  {
    id: 'a',
    name: 'Alice',
    email: 'alice@example.com',
    status: 'active',
    member_metrics: {
      last_attended_at: '2024-01-01',
      prickles_last_30_days: 3,
      total_prickles: 20,
      engagement_score: 80,
    },
    member_engagement: { risk_level: 'low', engagement_tier: 'highly_engaged' },
  },
  {
    id: 'b',
    name: 'Bob',
    email: 'bob@example.com',
    status: 'cancelled',
    member_metrics: {
      last_attended_at: '2024-02-01',
      prickles_last_30_days: 0,
      total_prickles: 10,
      engagement_score: 40,
    },
    member_engagement: { risk_level: 'medium', engagement_tier: 'casual' },
  },
]

function renderedNames() {
  return screen.getAllByRole('link').map((link) => link.textContent)
}

describe('MembersTable sorting', () => {
  it('renders rows in the given prop order by default', () => {
    render(<MembersTable members={members} />)
    expect(renderedNames()).toEqual(['Carol', 'Alice', 'Bob'])
  })

  it('sorts ascending by name on first click', async () => {
    render(<MembersTable members={members} />)
    await userEvent.click(screen.getByText('Name'))
    expect(renderedNames()).toEqual(['Alice', 'Bob', 'Carol'])
  })

  it('sorts descending by name on second click', async () => {
    render(<MembersTable members={members} />)
    const header = screen.getByText('Name')
    await userEvent.click(header)
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Carol', 'Bob', 'Alice'])
  })

  it('reverts to original prop order on third click', async () => {
    render(<MembersTable members={members} />)
    const header = screen.getByText('Name')
    await userEvent.click(header)
    await userEvent.click(header)
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Carol', 'Alice', 'Bob'])
  })
})
