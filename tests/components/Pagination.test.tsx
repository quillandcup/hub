// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination } from '@/components/Pagination'
import HedgieversariesTable, { type HedgieversaryRow } from '@/app/(admin)/admin/hedgieversaries/HedgieversariesTable'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('Pagination', () => {
  it('renders nothing while everything fits on one page', () => {
    const { container } = render(<Pagination page={1} pageSize={50} total={20} onPageChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the item range and disables Prev on the first page', () => {
    render(<Pagination page={1} pageSize={50} total={134} onPageChange={() => {}} itemLabel="members" />)
    expect(screen.getByText('Showing 1–50 of 134 members')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  it('reports page and page-size changes', async () => {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()
    render(
      <Pagination page={3} pageSize={50} total={134} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    )
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /prev/i }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    await userEvent.selectOptions(screen.getByRole('combobox'), '100')
    expect(onPageSizeChange).toHaveBeenCalledWith(100)
  })
})

// Auto-pagination via useDataTable on a real table.
describe('client-side paging on HedgieversariesTable', () => {
  // 60 fictional members; first-joined dates ascend with the index.
  const rows: HedgieversaryRow[] = Array.from({ length: 60 }, (_, i) => ({
    id: `m${i}`,
    name: `Hedgie ${String(i).padStart(2, '0')}`,
    email: `h${i}@example.com`,
    firstJoinedAt: `20${String(10 + Math.floor(i / 12)).padStart(2, '0')}-${String((i % 12) + 1).padStart(2, '0')}-01`,
    mostRecentJoinedAt: null,
    totalActiveMonths: i,
    nextDate: null,
    milestoneMonths: null,
    recentDate: null,
    recentMilestoneMonths: null,
    cumulativeHiatusMonths: 0,
    hiatusWindows: [],
  }))
  const names = () => screen.getAllByRole('link').map((l) => l.textContent)

  it('shows 50 rows per page and pages through the rest', async () => {
    render(<HedgieversariesTable rows={rows} asOf="2026-09-26T00:00:00Z" />)
    expect(names()).toHaveLength(50)
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(names()).toHaveLength(10)
    expect(screen.getByText('Showing 51–60 of 60 members')).toBeInTheDocument()
  })

  it('sorts across all pages and returns to page 1 on a new sort', async () => {
    render(<HedgieversariesTable rows={rows} asOf="2026-09-26T00:00:00Z" />)
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByText('First Joined'))
    await userEvent.click(screen.getByText('First Joined')) // descending
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    // The newest joiner overall (last index) leads page 1, not just the newest on the old page.
    expect(names()[0]).toBe('Hedgie 59')
  })
})
