// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PricklesTable from '@/app/(admin)/admin/insights/prickles/PricklesTable'
import type { TypeStats } from '@/lib/scheduled-prickle-stats'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function row(typeName: string, sessions: number): TypeStats {
  return {
    typeId: typeName,
    typeName,
    normalizedName: typeName.toLowerCase(),
    sessions,
    min: 10,
    median: 20,
    mean: 20,
    max: 30,
    sparkline: [],
    lastSession: '2024-01-01',
  }
}

const rows = [row('Zeta', 5), row('Alpha', 10), row('Mid', 1)]

function renderedNames() {
  return screen.getAllByRole('link').map((link) => link.textContent)
}

describe('PricklesTable tri-state sort', () => {
  it('defaults to sessions descending', () => {
    render(<PricklesTable rows={rows} />)
    expect(renderedNames()).toEqual(['Alpha', 'Zeta', 'Mid'])
  })

  it('sorts by name ascending then descending on the first two clicks', async () => {
    render(<PricklesTable rows={rows} />)
    const header = screen.getByText('Name')
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Alpha', 'Mid', 'Zeta'])
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Zeta', 'Mid', 'Alpha'])
  })

  it('flips the default Sessions column to ascending on its first click, then back', async () => {
    render(<PricklesTable rows={rows} />)
    const header = screen.getByText('Sessions')
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Mid', 'Zeta', 'Alpha'])
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Alpha', 'Zeta', 'Mid'])
  })

  it('sorts Last Session timestamps chronologically, not lexically', async () => {
    const timed = [
      // 08:00Z: lexically last, chronologically first
      { ...row('Early', 1), lastSession: '2024-01-05T10:00:00+02:00' },
      { ...row('Late', 2), lastSession: '2024-01-05T09:30:00.5Z' },
      { ...row('Middle', 3), lastSession: '2024-01-05T09:00:00+00:00' },
    ]
    render(<PricklesTable rows={timed} />)
    const header = screen.getByText('Last Session')
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Early', 'Middle', 'Late'])
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Late', 'Middle', 'Early'])
  })

  it('reverts to the sessions-descending default on the third click', async () => {
    render(<PricklesTable rows={rows} />)
    const header = screen.getByText('Name')
    await userEvent.click(header)
    await userEvent.click(header)
    await userEvent.click(header)
    expect(renderedNames()).toEqual(['Alpha', 'Zeta', 'Mid'])
  })
})
