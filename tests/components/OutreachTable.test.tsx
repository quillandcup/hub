// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OutreachTable, { type OutreachLead } from '@/app/(admin)/admin/outreach/OutreachTable'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}))

const leads: OutreachLead[] = [
  {
    id: 'a',
    name: 'Alice',
    email: 'alice@example.com',
    photoUrl: null,
    instagramUrl: 'https://instagram.com/alice_handle',
    memberStatus: 'lead',
    outreachStatus: 'cold',
    outreachUpdatedAt: null,
    lastTouchedAt: null,
  },
  {
    id: 'b',
    name: 'Bob',
    email: 'bob@example.com',
    photoUrl: null,
    instagramUrl: null,
    memberStatus: 'lead',
    outreachStatus: 'cold',
    outreachUpdatedAt: null,
    lastTouchedAt: null,
  },
  {
    id: 'c',
    name: 'Carol',
    email: 'carol@example.com',
    photoUrl: null,
    instagramUrl: 'https://instagram.com/carol_handle',
    memberStatus: 'cancelled',
    outreachStatus: 'cold',
    outreachUpdatedAt: null,
    lastTouchedAt: null,
  },
]

function switchToAllLeads() {
  return userEvent.click(screen.getByRole('button', { name: /all leads/i }))
}

describe('OutreachTable — All Leads view', () => {
  it('shows current leads by default and reveals former members via the filter', async () => {
    render(<OutreachTable leads={leads} initialTodayCount={0} />)
    await switchToAllLeads()

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.queryByText('Carol')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /include former members/i }))
    expect(screen.getByText('Carol')).toBeInTheDocument()
  })

  it('hides leads without Instagram when the Instagram filter is checked', async () => {
    render(<OutreachTable leads={leads} initialTodayCount={0} />)
    await switchToAllLeads()

    const profileLinks = screen.getAllByText('Profile')
    expect(profileLinks[0]).toHaveAttribute('href', 'https://instagram.com/alice_handle')
    expect(profileLinks[1]).not.toHaveAttribute('href')

    await userEvent.click(screen.getByRole('checkbox', { name: /only show leads with instagram/i }))
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })
})

describe("OutreachTable — Today's Queue view (default)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ touch: { id: 't1', touched_at: new Date().toISOString(), member_id: 'a' } }),
      }))
    )
  })

  it('only queues current, Instagram-reachable leads', () => {
    render(<OutreachTable leads={leads} initialTodayCount={0} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument() // no Instagram handle
    expect(screen.queryByText('Carol')).not.toBeInTheDocument() // former member, excluded by default
  })

  it('logging an outreach increments the daily count and marks the lead done', async () => {
    render(<OutreachTable leads={leads} initialTodayCount={3} />)
    expect(screen.getByText(/today.s outreach: 3 \/ 25/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /log outreach/i }))

    expect(await screen.findByText(/today.s outreach: 4 \/ 25/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /logged/i })).toBeDisabled()
  })

  it('hides the remaining queue once "Done for today" is clicked', async () => {
    render(<OutreachTable leads={leads} initialTodayCount={0} />)
    await userEvent.click(screen.getByRole('button', { name: /done for today/i }))

    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getByText(/all caught up for today/i)).toBeInTheDocument()
  })
})
