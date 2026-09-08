// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
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
  },
]

describe('OutreachTable Instagram filter', () => {
  it('shows every lead by default, with Profile/DM disabled for leads with no Instagram', () => {
    render(<OutreachTable leads={leads} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()

    const profileLinks = screen.getAllByText('Profile')
    expect(profileLinks).toHaveLength(2)
    // Alice has a handle -> real href; Bob has none -> disabled (no href)
    expect(profileLinks[0]).toHaveAttribute('href', 'https://instagram.com/alice_handle')
    expect(profileLinks[1]).not.toHaveAttribute('href')
  })

  it('hides leads without Instagram when the filter checkbox is checked', async () => {
    render(<OutreachTable leads={leads} />)
    const checkbox = screen.getByRole('checkbox', { name: /only show leads with instagram/i })

    await userEvent.click(checkbox)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()

    await userEvent.click(checkbox)
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows an empty-state message when the filter matches no leads', async () => {
    render(<OutreachTable leads={[leads[1]]} />)
    const checkbox = screen.getByRole('checkbox', { name: /only show leads with instagram/i })

    await userEvent.click(checkbox)

    expect(screen.getByText('No leads with Instagram on file.')).toBeInTheDocument()
  })
})
