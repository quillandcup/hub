// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimezoneProvider } from '@/components/Timezone'
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

describe('MembersTable churn risk', () => {
  it('shows a churn risk badge only for active members', () => {
    render(<MembersTable members={members} />)
    expect(screen.getByText('Churn risk')).toBeTruthy()
    // Carol and Alice are active (low); Bob is cancelled (medium) and gets no badge.
    expect(screen.getAllByText('low')).toHaveLength(2)
    expect(screen.queryByText('medium')).toBeNull()
  })

  it('treats an active member with no engagement data as low risk', () => {
    const noData: MemberRow = { id: 'n', name: 'Nora', email: 'n@example.com', status: 'active', member_metrics: null, member_engagement: null } as MemberRow
    render(<MembersTable members={[noData]} />)
    expect(screen.getByText('low')).toBeTruthy()
  })
})

describe('MembersTable last attended', () => {
  it('shows the date in the viewer\'s zone from the provider', () => {
    const row = { ...members[0], member_metrics: { ...members[0].member_metrics!, last_attended_at: '2024-03-01T20:00:00Z' } }
    render(
      <TimezoneProvider zone="Pacific/Auckland">
        <MembersTable members={[row]} />
      </TimezoneProvider>
    )
    expect(screen.getByText('3/2/2024')).toBeTruthy()
  })

  it('falls back to the org timezone without a provider, not the host zone', () => {
    // 03:00 UTC on Mar 1 is still Feb 29 in Eastern time.
    const row = { ...members[0], member_metrics: { ...members[0].member_metrics!, last_attended_at: '2024-03-01T03:00:00Z' } }
    render(<MembersTable members={[row]} />)
    expect(screen.getByText('2/29/2024')).toBeTruthy()
  })
})

describe('MembersTable display names', () => {
  const withDisplay: MemberRow[] = [
    { ...members[0], id: 'z', name: 'Zelda Example', display_name: 'Ada E' },
    { ...members[1], id: 'm', name: 'Mary Example', display_name: null },
  ]

  it('shows the display name as the link with the legal name beneath it', () => {
    render(<MembersTable members={withDisplay} />)
    expect(screen.getByRole('link', { name: 'Ada E' })).toHaveAttribute('href', '/admin/members/z')
    expect(screen.getByText('Zelda Example')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Ada E')).toBeInTheDocument()
    // No display name: just the legal name, once.
    expect(screen.getAllByText('Mary Example')).toHaveLength(1)
  })

  it('sorts by the displayed name', async () => {
    render(<MembersTable members={withDisplay} />)
    await userEvent.click(screen.getByText('Name'))
    expect(renderedNames()).toEqual(['Ada E', 'Mary Example'])
  })
})
