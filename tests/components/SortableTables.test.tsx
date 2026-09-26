// @vitest-environment jsdom
// Tables converted to the shared useTableSort + SortableTh (#18): clicking a
// header reorders rows, and a second click reverses.
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import WorkQueueSections from '@/app/(admin)/admin/work-queue/WorkQueueSections'
import AllPricklesTable from '@/app/(member)/my-prickles/AllPricklesTable'
import AttendanceListTable from '@/components/AttendanceListTable'
import MemberSlackActivityPanel from '@/app/(admin)/admin/members/[id]/MemberSlackActivityPanel'
import UnmatchedEventsTable from '@/app/(admin)/admin/data/prickle-types/UnmatchedEventsTable'
import MissingStripeTable from '@/app/(admin)/admin/hygiene/missing-member-data/MissingStripeTable'
import PrickleTypesTable from '@/app/(admin)/admin/data/prickle-types/PrickleTypesTable'
import AliasesTable from '@/app/(admin)/admin/data/aliases/AliasesTable'
import ResubscribingMembersTable from '@/app/(admin)/admin/insights/resubscriptions/ResubscribingMembersTable'
import type { WorkQueueItem } from '@/lib/admin-work-queue'
import type { PrickleScheduleRow } from '@/lib/prickle-schedule'

// Text of the first cell in each body row.
function firstColumn(table: HTMLElement = screen.getByRole('table')) {
  const rows = within(table).getAllByRole('row').slice(1)
  return rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent?.trim())
}

function column(index: number, table: HTMLElement = screen.getByRole('table')) {
  const rows = within(table).getAllByRole('row').slice(1)
  return rows.map((row) => within(row).getAllByRole('cell')[index]?.textContent?.trim())
}

describe('WorkQueueSections', () => {
  const item = (memberName: string, deadline: string, label: string): WorkQueueItem => ({
    queueType: 'hedgieversary',
    memberId: memberName,
    memberName,
    occurrenceKey: deadline,
    deadline,
    label,
  })
  const queue = [item('Bramble', '2026-10-05', '1-Year'), item('Acorn', '2026-11-01', '3-Year'), item('Clover', '2026-09-30', '2-Year')]

  it('defaults to soonest deadline and sorts by Hedgie on click', async () => {
    render(<WorkQueueSections welcomeBackQueue={[]} hedgieversaryQueue={queue} hiatusNudgeQueue={[]} />)
    expect(column(1)).toEqual(['Clover', 'Bramble', 'Acorn'])
    await userEvent.click(screen.getByText('Hedgie'))
    expect(column(1)).toEqual(['Acorn', 'Bramble', 'Clover'])
    await userEvent.click(screen.getByText('Hedgie'))
    expect(column(1)).toEqual(['Clover', 'Bramble', 'Acorn'])
  })

  it('flips the default Deadline sort on its first click', async () => {
    render(<WorkQueueSections welcomeBackQueue={[]} hedgieversaryQueue={queue} hiatusNudgeQueue={[]} />)
    await userEvent.click(screen.getByText('Deadline'))
    expect(column(1)).toEqual(['Acorn', 'Bramble', 'Clover'])
  })
})

describe('AllPricklesTable', () => {
  const row = (seriesKey: string, day: string, sortKey: string, typeName: string, avg: number | null, sessions = 3): PrickleScheduleRow => ({
    seriesKey,
    sortKey,
    dayOfWeek: day,
    timeLabel: sortKey,
    typeId: typeName,
    typeName,
    nextOccurrenceId: seriesKey,
    nextOccurrenceStart: '2026-10-01T10:00:00Z',
    hostId: null,
    hostName: null,
    sessionCount: sessions,
    avgAttendance: avg,
  })
  const rows = [
    row('a', 'Monday', '1-09:00', 'Writing', 4),
    row('b', 'Monday', '1-10:00', 'Editing', 9),
    row('c', 'Monday', '1-11:00', 'Brand New', null, 0),
  ]
  // Row 0 is the Monday day-header row; the rest are prickles.
  const kinds = () => column(1).slice(1)

  it('sorts prickles within a day by Kind and by typical attendance', async () => {
    render(<AllPricklesTable rows={rows} />)
    expect(kinds()).toEqual(['Writing', 'Editing', 'Brand New'])
    await userEvent.click(screen.getByText('Kind'))
    expect(kinds()).toEqual(['Brand New', 'Editing', 'Writing'])
    await userEvent.click(screen.getByText('Typically'))
    expect(kinds()).toEqual(['Writing', 'Editing', 'Brand New'])
    await userEvent.click(screen.getByText('Typically'))
    // Descending: new prickles (no attendance yet) come first.
    expect(kinds()).toEqual(['Brand New', 'Editing', 'Writing'])
  })
})

describe('AttendanceListTable', () => {
  const record = (id: string, type: string, join: string, leave: string) => ({
    id,
    join_time: join,
    leave_time: leave,
    prickles: { id, prickle_types: { name: type }, host: null },
  })
  const attendance = [
    record('1', 'Writing', '2026-09-01T14:00:00Z', '2026-09-01T15:00:00Z'),
    record('2', 'Editing', '2026-09-01T16:00:00Z', '2026-09-01T16:20:00Z'),
  ]

  it('sorts rows within each date by Duration', async () => {
    render(<AttendanceListTable attendance={attendance} timezone="UTC" activeListDateKey={undefined} memberId="m" />)
    const types = () => column(0).filter((t) => t === 'Writing' || t === 'Editing')
    expect(types()).toEqual(['Writing', 'Editing'])
    await userEvent.click(screen.getByText('Duration'))
    expect(types()).toEqual(['Editing', 'Writing'])
  })
})

describe('MemberSlackActivityPanel', () => {
  const activity = (id: string, channel: string, occurred: string) => ({
    id,
    activity_type: 'slack_message',
    occurred_at: occurred,
    description: `message ${id}`,
    data: { channel_name: channel },
  })
  const activities = [
    activity('1', 'writing', '2026-09-01T10:00:00Z'),
    activity('2', 'announcements', '2026-09-20T10:00:00Z'),
    activity('3', 'general', '2026-09-10T10:00:00Z'),
  ]

  it('defaults to newest first and sorts by Channel on click', async () => {
    render(<MemberSlackActivityPanel slackActivities={activities} />)
    const table = screen.getByRole('table')
    expect(column(1, table)).toEqual(['#announcements', '#general', '#writing'])
    await userEvent.click(within(table).getByText('Date'))
    expect(column(1, table)).toEqual(['#writing', '#general', '#announcements'])
    await userEvent.click(within(table).getByText('Channel'))
    expect(column(1, table)).toEqual(['#announcements', '#general', '#writing'])
  })
})

describe('UnmatchedEventsTable', () => {
  const group = (summary: string, count: number) => ({
    summary,
    count,
    eventIds: [],
    calendarEventIds: [],
    suggestedType: null,
    suggestedHost: null,
  })

  it('sorts event groups by Count', async () => {
    render(<UnmatchedEventsTable eventGroups={[group('Beta', 2), group('Alpha', 7), group('Gamma', 1)]} prickleTypes={[]} />)
    await userEvent.click(screen.getByText('Count'))
    expect(firstColumn()).toEqual(['Gamma', 'Beta', 'Alpha'])
    await userEvent.click(screen.getByText('Count'))
    expect(firstColumn()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })
})

describe('server-page tables extracted into sortable client components', () => {
  it('MissingStripeTable sorts by Email', async () => {
    render(
      <MissingStripeTable
        rows={[
          { id: '1', name: 'Acorn', email: 'zed@example.com', kajabi_id: null },
          { id: '2', name: 'Bramble', email: 'amy@example.com', kajabi_id: 'k2' },
        ]}
      />
    )
    expect(firstColumn()).toEqual(['Acorn', 'Bramble'])
    await userEvent.click(screen.getByText('Email'))
    expect(firstColumn()).toEqual(['Bramble', 'Acorn'])
  })

  it('PrickleTypesTable sorts by Purpose', async () => {
    const type = (id: string, name: string, purpose: string) => ({
      id,
      name,
      normalized_name: name.toLowerCase(),
      description: null,
      purpose,
      solo_task_friendly: false,
    })
    render(<PrickleTypesTable rows={[type('1', 'Alpha', 'writing'), type('2', 'Beta', 'social')]} />)
    expect(firstColumn()).toEqual(['Alpha', 'Beta'])
    await userEvent.click(screen.getByText('Purpose'))
    expect(firstColumn()).toEqual(['Beta', 'Alpha'])
  })

  it('AliasesTable sorts by alias count', async () => {
    const entry = (id: string, name: string, aliasCount: number) => ({
      member: { id, name, email: `${id}@example.com`, status: 'active' },
      aliases: Array.from({ length: aliasCount }, (_, i) => ({ id: `${id}-${i}`, alias: `${name}${i}`, created_at: '2026-01-01' })),
    })
    render(<AliasesTable rows={[entry('a', 'Acorn', 3), entry('b', 'Bramble', 1)]} />)
    await userEvent.click(screen.getByText('Aliases'))
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Bramble', 'Acorn'])
  })

  it('ResubscribingMembersTable sorts by latest rejoin, date-aware', async () => {
    const member = (name: string, rejoins: string[]) => ({
      memberId: name,
      memberName: name,
      memberEmail: `${name.toLowerCase()}@example.com`,
      isCurrentlyActive: true,
      resubscriptions: rejoins.map((r) => ({ resubscribedAt: r, cancelledAt: '2020-01-01T00:00:00Z', gapDays: 30 })),
    })
    render(
      <ResubscribingMembersTable
        members={[member('Acorn', ['2025-03-01T00:00:00Z']), member('Bramble', ['2024-01-01T00:00:00Z', '2026-02-01T00:00:00Z'])]}
      />
    )
    await userEvent.click(screen.getByText('History (latest rejoin)'))
    const names = () => screen.getAllByRole('link').map((l) => l.textContent)
    expect(names()).toEqual(['Acorn', 'Bramble'])
    await userEvent.click(screen.getByText('History (latest rejoin)'))
    expect(names()).toEqual(['Bramble', 'Acorn'])
  })
})
