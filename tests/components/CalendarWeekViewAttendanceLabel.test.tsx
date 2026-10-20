// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CalendarWeekView, { type Prickle } from '@/components/CalendarWeekView'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

const weekStartDate = { year: 2026, month: 5, day: 1 } // Mon 2026-06-01
const NOW = '2026-06-03T12:00:00Z'

function prickle(id: string, start: string, end: string, attendance_count: number): Prickle {
  return { id, host: 'Host', start_time: start, end_time: end, prickle_type: `Type ${id}`, attendance_count }
}

function renderView(
  prickles: Prickle[],
  mode: 'admin' | 'member' = 'admin',
  attendanceDataThrough: string | null | undefined = '2026-06-03T10:00:00Z'
) {
  return render(
    <CalendarWeekView
      prickles={prickles}
      weekStartDate={weekStartDate}
      userTimezonePreference="UTC"
      mode={mode}
      attendanceDataThrough={attendanceDataThrough}
    />
  )
}

describe('CalendarWeekView attendance label', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows no attendance line for a prickle that has not started', () => {
    renderView([prickle('future', '2026-06-04T10:00:00Z', '2026-06-04T11:00:00Z', 0)])
    expect(screen.getByText('Type future')).toBeInTheDocument()
    expect(screen.queryByText(/attendee/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Awaiting data/)).not.toBeInTheDocument()
  })

  it('shows "Awaiting data" for an ended prickle that started after the newest imported meeting', () => {
    renderView([prickle('late', '2026-06-03T10:30:00Z', '2026-06-03T11:30:00Z', 0)])
    expect(screen.getByText('Awaiting data')).toBeInTheDocument()
    expect(screen.queryByText(/0 attendees/)).not.toBeInTheDocument()
  })

  it('shows "0 attendees" for a prickle that started before the newest imported meeting (nobody came)', () => {
    renderView([prickle('quiet', '2026-06-03T09:00:00Z', '2026-06-03T10:00:00Z', 0)])
    expect(screen.getByText('0 attendees')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting data')).not.toBeInTheDocument()
  })

  it('shows "Awaiting data" for every ended empty prickle when nothing was ever imported', () => {
    renderView([prickle('never', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z', 0)], 'admin', null)
    expect(screen.getByText('Awaiting data')).toBeInTheDocument()
  })

  it('counts a prickle running at the same time as an imported meeting as covered', () => {
    renderView([prickle('same', '2026-06-03T10:00:00Z', '2026-06-03T11:00:00Z', 0)])
    expect(screen.getByText('0 attendees')).toBeInTheDocument()
  })

  it('shows "Awaiting data" for a prickle still in progress with no attendance', () => {
    renderView([prickle('live', '2026-06-03T11:30:00Z', '2026-06-03T12:30:00Z', 0)], 'admin', '2026-06-03T11:45:00Z')
    expect(screen.getByText('Awaiting data')).toBeInTheDocument()
  })

  it('shows the count when no import time is given', () => {
    renderView([prickle('unknown', '2026-06-03T09:00:00Z', '2026-06-03T10:00:00Z', 0)], 'admin', undefined)
    expect(screen.getByText('0 attendees')).toBeInTheDocument()
  })

  it('shows the count for a recently ended prickle that has attendance', () => {
    renderView([prickle('done', '2026-06-03T09:00:00Z', '2026-06-03T10:00:00Z', 1)])
    expect(screen.getByText('1 attendee')).toBeInTheDocument()
  })

  it('pluralizes the count', () => {
    renderView([prickle('many', '2026-06-02T09:00:00Z', '2026-06-02T10:00:00Z', 5)])
    expect(screen.getByText('5 attendees')).toBeInTheDocument()
  })

  it('shows no attendance line in member mode', () => {
    renderView([prickle('m', '2026-06-02T09:00:00Z', '2026-06-02T10:00:00Z', 3)], 'member')
    expect(screen.queryByText(/attendee/)).not.toBeInTheDocument()
  })
})
