// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EventsBrowser, { type EventRow, type EducationalPrickle } from '@/app/(member)/events/EventsBrowser'

const TODAY = '2026-09-26'

function event(id: string, event_type: string, starts_at: string, ends_at = starts_at): EventRow {
  return { id, slug: id, title: `Event ${id}`, event_type, location: null, starts_at, ends_at, focus: null, cover_photo_id: null }
}

const EVENTS: EventRow[] = [
  event('lake', 'in_person_retreat', '2026-11-01', '2026-11-04'),
  event('zoomy', 'virtual_retreat', '2026-10-10', '2026-10-11'),
  event('party', 'other', '2026-12-01'),
  event('spring', 'in_person_retreat', '2026-03-01', '2026-03-05'),
]

const EDU: EducationalPrickle[] = Array.from({ length: 6 }, (_, i) => ({
  id: `edu${i}`,
  title: `Craft Class ${i}`,
  typeName: 'Educational Prickle',
  hostName: 'Jane Doe',
  startTime: `2026-10-0${i + 1}T16:00:00Z`,
  endTime: `2026-10-0${i + 1}T17:00:00Z`,
}))

function renderBrowser(initialFilter: Parameters<typeof EventsBrowser>[0]['initialFilter'] = 'all') {
  return render(
    <EventsBrowser initialFilter={initialFilter} events={EVENTS} educationalPrickles={EDU} today={TODAY} timeZone="UTC" />
  )
}

const typeGroup = () => screen.getByRole('group', { name: 'Event type' })

describe('EventsBrowser', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/events')
  })

  it('shows all events plus a highlighted educational preview by default', () => {
    renderBrowser()
    expect(within(typeGroup()).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
    const edu = screen.getByRole('region', { name: 'Upcoming educational prickles' })
    expect(within(edu).getAllByRole('link')).toHaveLength(4)
    expect(within(edu).getByRole('button', { name: /See all 6 educational prickles/ })).toBeInTheDocument()
    expect(screen.getByText('Event lake')).toBeInTheDocument()
    expect(screen.getByText('Event party')).toBeInTheDocument()
    expect(screen.getByText('Event spring')).toBeInTheDocument()
  })

  it('filters to retreats, reveals format sub-filter, and syncs ?type=', async () => {
    renderBrowser()
    await userEvent.click(within(typeGroup()).getByRole('button', { name: /Retreats/ }))
    expect(screen.queryByText('Event party')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Upcoming educational prickles' })).not.toBeInTheDocument()
    expect(screen.getByText('Event lake')).toBeInTheDocument()
    expect(window.location.search).toBe('?type=retreats')

    const format = screen.getByRole('group', { name: 'Retreat format' })
    await userEvent.click(within(format).getByRole('button', { name: /Virtual/ }))
    expect(screen.getByText('Event zoomy')).toBeInTheDocument()
    expect(screen.queryByText('Event lake')).not.toBeInTheDocument()
    expect(within(typeGroup()).getByRole('button', { name: /Retreats/ })).toHaveAttribute('aria-pressed', 'true')
    expect(window.location.search).toBe('?type=virtual_retreat')
  })

  it('honors a deep-linked sub-filter', () => {
    renderBrowser('in_person_retreat')
    expect(within(typeGroup()).getByRole('button', { name: /Retreats/ })).toHaveAttribute('aria-pressed', 'true')
    const format = screen.getByRole('group', { name: 'Retreat format' })
    expect(within(format).getByRole('button', { name: /In person/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Event lake')).toBeInTheDocument()
    expect(screen.queryByText('Event zoomy')).not.toBeInTheDocument()
  })

  it('"See all" switches to the full educational list and clears events', async () => {
    renderBrowser()
    await userEvent.click(screen.getByRole('button', { name: /See all 6 educational prickles/ }))
    const edu = screen.getByRole('region', { name: 'Upcoming educational prickles' })
    expect(within(edu).getAllByRole('link')).toHaveLength(6)
    expect(screen.queryByText('Event lake')).not.toBeInTheDocument()
    expect(window.location.search).toBe('?type=educational')
  })

  it('removes ?type= when returning to All', async () => {
    renderBrowser('other')
    expect(screen.getByText('Event party')).toBeInTheDocument()
    expect(screen.getByText('No past other events yet.')).toBeInTheDocument()
    await userEvent.click(within(typeGroup()).getByRole('button', { name: /^All/ }))
    expect(window.location.search).toBe('')
  })
})
