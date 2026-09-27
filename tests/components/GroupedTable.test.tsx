// @vitest-environment jsdom
// Prickles insights grouped table: the linked group (?slot= -> defaultExpanded)
// is expanded and scrolled to even when it sorts onto page 2+.
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupedTable from '@/app/(admin)/admin/insights/prickles/[kind]/GroupedTable'
import type { GroupStats } from '@/lib/scheduled-prickle-stats'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// 60 groups, "Slot 00".."Slot 59"; sessions ascend with the index.
const groups: GroupStats[] = Array.from({ length: 60 }, (_, i) => ({
  groupKey: `slot-${i}`,
  groupLabel: `Slot ${String(i).padStart(2, '0')}`,
  sessions: i + 1,
  min: 1,
  median: 2,
  mean: 2,
  max: 3,
  sparkline: [],
  lastSession: '2026-09-01T10:00:00Z',
  prickleSessions: [
    { id: `p-${i}`, startTime: '2026-09-01T10:00:00Z', attendeeCount: 2, attendeeNames: ['Fern', 'Wren'], hostName: null },
  ],
}))

let scrolled: Element[]
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  scrolled = []
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this)
  })
})
afterEach(() => vi.useRealTimers())

const linkedRow = () => screen.getByText('Slot 55').closest('tr')!

describe('GroupedTable linked group', () => {
  it('opens on the page holding the linked group, expanded and scrolled to', async () => {
    render(<GroupedTable rows={groups} groupBy="schedule" defaultExpanded="slot-55" />)
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(linkedRow()).toBeInTheDocument()
    expect(screen.getByText(/1 session — most recent first/)).toBeInTheDocument()
    vi.advanceTimersByTime(200)
    expect(scrolled).toContain(linkedRow())
  })

  it('keeps the linked group on screen after a sort change', async () => {
    render(<GroupedTable rows={groups} groupBy="schedule" defaultExpanded="slot-55" />)
    // Sessions descending puts slot-55 fifth -> page 1.
    const sessions = screen.getAllByText('Sessions')[0]
    await userEvent.click(sessions)
    await userEvent.click(sessions)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(within(linkedRow()).getByText('Slot 55')).toBeInTheDocument()
  })

  it('starts on page 1 without a linked group', () => {
    render(<GroupedTable rows={groups} groupBy="schedule" />)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.queryByText('Slot 55')).toBeNull()
  })
})
