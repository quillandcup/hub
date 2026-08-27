// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemberFilters from '@/app/(admin)/admin/members/MemberFilters'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('filter=active'),
}))

const counts = {
  all: 42,
  active: 30,
  at_risk: 5,
  highly_engaged: 8,
  on_hiatus: 2,
  unregistered: 1,
}

beforeEach(() => {
  push.mockClear()
})

describe('MemberFilters counts', () => {
  it('shows the count for every filter tab', () => {
    render(<MemberFilters currentFilter="active" counts={counts} />)

    expect(screen.getByText('All Members')).toBeInTheDocument()
    expect(screen.getByText('(42)')).toBeInTheDocument()
    expect(screen.getByText('(30)')).toBeInTheDocument()
    expect(screen.getByText('(5)')).toBeInTheDocument()
    expect(screen.getByText('(8)')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  it('highlights the currently selected filter', () => {
    render(<MemberFilters currentFilter="at_risk" counts={counts} />)
    expect(screen.getByText('At Risk').closest('button')).toHaveClass('bg-blue-600')
    expect(screen.getByText('Active Only').closest('button')).not.toHaveClass('bg-blue-600')
  })

  it('navigates with the clicked filter value on click', async () => {
    render(<MemberFilters currentFilter="active" counts={counts} />)
    await userEvent.click(screen.getByText('On Hiatus'))
    expect(push).toHaveBeenCalledWith('/admin/members?filter=on_hiatus')
  })
})
