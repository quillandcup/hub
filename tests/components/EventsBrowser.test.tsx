// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EventsBrowser, { type EventRow, type EventPrickle } from '@/app/(member)/events/EventsBrowser'

const TODAY = '2026-09-26'

function event(id: string, event_type: string, starts_at: string, ends_at = starts_at, registration: string | null = null): EventRow {
  return { id, slug: id, title: `Event ${id}`, event_type, location: null, starts_at, ends_at, focus: null, registration, cover_photo_id: null }
}

const EVENTS: EventRow[] = [
  event('lake', 'in_person_retreat', '2026-11-01', '2026-11-04'),
  event('zoomy', 'virtual_retreat', '2026-10-10', '2026-10-11'),
  event('party', 'social', '2026-12-01'),
  event('webinar', 'educational', '2026-10-15'),
  event('pitch', 'session', '2026-10-05'),
  event('spring', 'in_person_retreat', '2026-03-01', '2026-03-05'),
]

const PRICKLES: EventPrickle[] = [
  { id: 'p1', title: 'Craft Class', typeName: 'Webinar Prickle', hostName: 'Jane Doe', calendarEventId: null, startTime: '2026-10-02T16:00:00Z', endTime: '2026-10-02T17:00:00Z' },
]

function renderBrowser(initialFilter: Parameters<typeof EventsBrowser>[0]['initialFilter'] = 'all', events = EVENTS) {
  return render(<EventsBrowser initialFilter={initialFilter} events={events} eventPrickles={PRICKLES} today={TODAY} timeZone="UTC" />)
}

const typeGroup = () => screen.getByRole('group', { name: 'Event type' })

describe('EventsBrowser', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/events')
  })

  it('groups upcoming events by how big a deal they are, with a picture on each card', () => {
    renderBrowser()
    expect(within(typeGroup()).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')

    const big = screen.getByRole('region', { name: 'Big events' })
    expect(within(big).getByText('Event lake')).toBeInTheDocument()
    expect(within(big).getByText('Event zoomy')).toBeInTheDocument()
    expect(within(big).getAllByTestId('event-art')).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: 'Educational' })).getByText('Event webinar')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Events' })).getByText('Event party')).toBeInTheDocument()

    const past = screen.getByRole('region', { name: 'Past' })
    expect(within(past).getByText('Event spring')).toBeInTheDocument()
  })

  it('lists sessions, and the featured prickles, as quiet rows', () => {
    renderBrowser()
    const sessions = screen.getByRole('region', { name: 'Sessions' })
    expect(within(sessions).getByRole('link', { name: /Event pitch/ })).toHaveAttribute('href', '/events/pitch')
    expect(within(sessions).getByText('Craft Class')).toBeInTheDocument()
    expect(within(sessions).getByText('Webinar Prickle')).toBeInTheDocument()
    expect(within(sessions).getByRole('link', { name: /Craft Class/ })).toHaveAttribute('href', '/prickles/p1')
  })

  it('says which events need a sign-up', () => {
    renderBrowser('all', [event('class', 'educational', '2026-10-15', '2026-10-15', 'required')])
    const big = screen.getByRole('region', { name: 'Big events' })
    expect(within(big).getByText(/Educational · Sign-up required/)).toBeInTheDocument()
  })

  it('filters to one tier and syncs ?type=', async () => {
    renderBrowser()
    await userEvent.click(within(typeGroup()).getByRole('button', { name: /Educational/ }))
    expect(screen.getByText('Event webinar')).toBeInTheDocument()
    expect(screen.queryByText('Event lake')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(window.location.search).toBe('?type=educational')
    expect(screen.getByText('No past educational events yet.')).toBeInTheDocument()
  })

  it('shows only sessions and prickles under Sessions', () => {
    renderBrowser('sessions')
    expect(screen.getByRole('region', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Big events' })).not.toBeInTheDocument()
  })

  it('says so when a filter has nothing upcoming, and drops ?type= on All', async () => {
    renderBrowser('events', EVENTS.filter((e) => e.id !== 'party'))
    expect(screen.getByText('No upcoming events scheduled yet.')).toBeInTheDocument()
    await userEvent.click(within(typeGroup()).getByRole('button', { name: /^All/ }))
    expect(window.location.search).toBe('')
  })
})

describe('EventsBrowser locations', () => {
  it('shows a video call link as Online (Zoom) and a place as typed, without printing the link', () => {
    const online = { ...event('talk', 'social', '2026-12-05'), location: 'https://us06web.zoom.us/j/87106462893?pwd=secret' }
    const place = { ...event('retreat', 'in_person_retreat', '2026-12-06'), location: 'Cedar Lodge' }
    render(<EventsBrowser initialFilter="all" events={[online, place]} eventPrickles={[]} today={TODAY} timeZone="UTC" />)

    expect(screen.getByText(/· Online \(Zoom\)/)).toBeInTheDocument()
    expect(screen.getByText(/· Cedar Lodge/)).toBeInTheDocument()
    expect(screen.queryByText(/zoom\.us/)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })
})
