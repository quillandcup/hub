// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MemberRow } from '@/app/(admin)/admin/members/MembersTable'

const push = vi.fn()
let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/admin/members',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import PagedMembersTable from '@/app/(admin)/admin/members/PagedMembersTable'

// Server-sorted page: rendered as given, never re-sorted in the browser.
const members: MemberRow[] = ['Zed', 'Amy', 'Moe'].map((name) => ({
  id: name,
  name,
  email: `${name.toLowerCase()}@example.com`,
  status: 'active',
  member_metrics: { last_attended_at: null, prickles_last_30_days: 0, total_prickles: 0, engagement_score: 0 },
  member_engagement: { risk_level: 'high', engagement_tier: 'at_risk' },
}))

function renderTable(total = 134, page = 1) {
  render(<PagedMembersTable members={members} total={total} page={page} pageSize={50} />)
}

describe('PagedMembersTable (server-side paging)', () => {
  beforeEach(() => {
    push.mockClear()
    search = 'filter=all&page=3'
  })

  it('renders rows in server order and marks the default Name sort active', () => {
    renderTable()
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Zed', 'Amy', 'Moe'])
    expect(screen.getByText('Name').closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('puts a header click in the URL and returns to page 1', async () => {
    renderTable()
    await userEvent.click(screen.getByText('Total'))
    expect(push).toHaveBeenCalledWith('/admin/members?filter=all&sort=total_prickles&dir=asc')
  })

  it('flips the default Name sort on its first click', async () => {
    renderTable()
    await userEvent.click(screen.getByText('Name'))
    expect(push).toHaveBeenCalledWith('/admin/members?filter=all&sort=name&dir=desc')
  })

  it('clears the sort params on the third click of a column', async () => {
    search = 'filter=all&sort=total_prickles&dir=desc'
    renderTable()
    await userEvent.click(screen.getByText('Total'))
    expect(push).toHaveBeenCalledWith('/admin/members?filter=all')
  })

  it('pages via the URL, keeping filter and sort', async () => {
    search = 'filter=all&sort=total_prickles&dir=desc'
    renderTable()
    expect(screen.getByText('Showing 1–50 of 134 members')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(push).toHaveBeenCalledWith('/admin/members?filter=all&sort=total_prickles&dir=desc&page=2')
    await userEvent.selectOptions(screen.getByRole('combobox'), '100')
    expect(push).toHaveBeenLastCalledWith('/admin/members?filter=all&sort=total_prickles&dir=desc&pageSize=100')
  })
})
