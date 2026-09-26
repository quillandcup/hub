// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HedgieversariesTable, { type HedgieversaryRow } from '@/app/(admin)/admin/hedgieversaries/HedgieversariesTable'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function row(name: string, overrides: Partial<HedgieversaryRow> = {}): HedgieversaryRow {
  return {
    id: name,
    name,
    email: `${name.toLowerCase()}@example.com`,
    firstJoinedAt: '2023-01-01',
    mostRecentJoinedAt: null,
    totalActiveMonths: 12,
    nextDate: null,
    milestoneMonths: null,
    recentDate: null,
    recentMilestoneMonths: null,
    cumulativeHiatusMonths: 0,
    hiatusWindows: [],
    ...overrides,
  }
}

// Fictional members. Dates are chosen so that string order, day-of-month
// order, and chronological order all disagree.
const rows = [
  row('Bramble', { firstJoinedAt: '2022-11-05', mostRecentJoinedAt: '2022-11-05', nextDate: '2026-11-05', milestoneMonths: 48 }),
  row('Thistle', { firstJoinedAt: '2024-02-20', mostRecentJoinedAt: null, nextDate: null }),
  row('Acorn', { firstJoinedAt: '2021-03-15', mostRecentJoinedAt: '2025-06-01', nextDate: '2027-01-15', milestoneMonths: 60 }),
  row('Clover', { firstJoinedAt: '2023-09-30', mostRecentJoinedAt: '2023-09-30', nextDate: '2026-09-30', milestoneMonths: 36 }),
  row('Hazel', { firstJoinedAt: '2025-01-10', mostRecentJoinedAt: '2025-01-10', nextDate: null }),
]

function renderedNames() {
  return screen.getAllByRole('link').map((link) => link.textContent)
}

function renderTable() {
  render(<HedgieversariesTable rows={rows} asOf="2026-09-26T00:00:00Z" />)
}

describe('HedgieversariesTable date sorting', () => {
  it('defaults to the soonest Next Hedgieversary first, TBD last', () => {
    renderTable()
    expect(renderedNames()).toEqual(['Clover', 'Bramble', 'Acorn', 'Thistle', 'Hazel'])
  })

  it('flips the default Next Hedgieversary sort to descending on the first click, TBD first', async () => {
    renderTable()
    await userEvent.click(screen.getByText('Next Hedgieversary'))
    expect(renderedNames()).toEqual(['Thistle', 'Hazel', 'Acorn', 'Bramble', 'Clover'])
  })

  it('returns to ascending on the second click of Next Hedgieversary', async () => {
    renderTable()
    const header = screen.getByText('Next Hedgieversary')
    await userEvent.click(header)
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Clover', 'Bramble', 'Acorn', 'Thistle', 'Hazel'])
  })

  it('sorts First Joined chronologically ascending then descending', async () => {
    renderTable()
    const header = screen.getByText('First Joined')
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Acorn', 'Bramble', 'Clover', 'Thistle', 'Hazel'])
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Hazel', 'Thistle', 'Clover', 'Bramble', 'Acorn'])
  })

  it('sorts Most Recent Joined with missing dates last ascending and first descending', async () => {
    renderTable()
    const header = screen.getByText('Most Recent Joined')
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Bramble', 'Clover', 'Hazel', 'Acorn', 'Thistle'])
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Thistle', 'Acorn', 'Hazel', 'Clover', 'Bramble'])
  })

  it('reverts to the Next Hedgieversary default after a third click on another column', async () => {
    renderTable()
    const header = screen.getByText('First Joined')
    await userEvent.click(header)
    await userEvent.click(header)
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Clover', 'Bramble', 'Acorn', 'Thistle', 'Hazel'])
  })
})
