// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EventsBrowser, { type EventRow, type EventPrickle } from '@/app/(member)/events/EventsBrowser'
import { agendaMonths } from '@/lib/events-agenda'

const TODAY = '2026-09-26'
const MONTHS = agendaMonths(TODAY) // September, October, November

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

type Props = Partial<Parameters<typeof EventsBrowser>[0]>

function renderBrowser({ events = EVENTS, eventPrickles = PRICKLES, timeZone = 'America/New_York', initialMonth = MONTHS[0].id, ...rest }: Props = {}) {
  return render(<EventsBrowser initialMonth={initialMonth} months={MONTHS} events={events} eventPrickles={eventPrickles} today={TODAY} timeZone={timeZone} {...rest} />)
}

const monthGroup = () => screen.getByRole('group', { name: 'Month' })
const glance = (label: string) => screen.getByRole('region', { name: `${label} at a glance` })

describe('EventsBrowser', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/events')
  })

  it('highlights upcoming special and educational events as cards with a picture, and leaves the past out', () => {
    renderBrowser()
    const special = screen.getByRole('region', { name: 'Special events' })
    for (const name of ['Event lake', 'Event zoomy', 'Event party']) expect(within(special).getByText(name)).toBeInTheDocument()
    expect(within(special).getAllByTestId('event-art')).toHaveLength(3)
    expect(within(screen.getByRole('region', { name: 'Educational' })).getByText('Event webinar')).toBeInTheDocument()
    expect(screen.queryByText('Event spring')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Past' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sessions' })).not.toBeInTheDocument()
  })

  it('offers this month and the next two, on the first', () => {
    renderBrowser()
    const buttons = within(monthGroup()).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([expect.stringMatching(/^September/), expect.stringMatching(/^October/), expect.stringMatching(/^November/)])
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('lists everything in the chosen month by day, sessions and featured prickles with the rest', async () => {
    renderBrowser({ initialMonth: MONTHS[1].id })
    const october = glance('October')
    const links = within(october).getAllByRole('link').map((a) => a.textContent).filter((t) => t !== 'See past events')
    expect(links[0]).toMatch(/^Craft Class with Jane D/) // Oct 2, a featured prickle
    expect(links[1]).toMatch(/^Event pitch/) // Oct 5
    expect(within(october).getByRole('link', { name: /Event pitch/ })).toHaveAttribute('href', '/events/pitch')
    expect(within(october).getByRole('link', { name: /Craft Class/ })).toHaveAttribute('href', '/prickles/p1')
    expect(within(october).queryByText(/Event lake/)).not.toBeInTheDocument() // November
  })

  it('says the current month shows what is still ahead, and links to past events for it', () => {
    renderBrowser()
    const september = glance('September')
    expect(within(september).getByText(/what's still ahead in September/)).toBeInTheDocument()
    expect(within(september).getByRole('link', { name: 'See past events' })).toHaveAttribute('href', '/events/past?month=2026-09')
  })

  it('links to past events without the note for a later month', async () => {
    renderBrowser({ initialMonth: MONTHS[1].id })
    const october = glance('October')
    expect(within(october).queryByText(/still ahead/)).not.toBeInTheDocument()
    expect(within(october).getByRole('link', { name: 'See past events' })).toHaveAttribute('href', '/events/past?month=')
  })

  it('divides the weeks, and puts the day on the left of its items', () => {
    renderBrowser({ initialMonth: MONTHS[1].id })
    const october = glance('October')
    // Oct 2 (Fri), Oct 5 (Mon), Oct 10-11 (Sat), Oct 15 (Thu): weeks of Sep 27, Oct 4, Oct 11
    expect(within(october).getAllByRole('separator')).toHaveLength(2)
    expect(within(october).getByLabelText('Fri, Oct 2')).toBeInTheDocument()
  })

  it('switches month, syncs ?month=, and drops it on the first month', async () => {
    renderBrowser()
    await userEvent.click(within(monthGroup()).getByRole('button', { name: /^November/ }))
    expect(within(glance('November')).getByText('Event lake')).toBeInTheDocument()
    expect(window.location.search).toBe(`?month=${MONTHS[2].id}`)
    await userEvent.click(within(monthGroup()).getByRole('button', { name: /^September/ }))
    expect(window.location.search).toBe('')
  })

  it('says so when a month has nothing', () => {
    renderBrowser({ events: [], eventPrickles: [] })
    expect(screen.getByText('Nothing scheduled in September yet.')).toBeInTheDocument()
  })

  it('says which events need a sign-up', () => {
    renderBrowser({ events: [event('class', 'educational', '2026-10-15', '2026-10-15', 'required')] })
    expect(within(screen.getByRole('region', { name: 'Special events' })).getByText(/Educational · Sign-up required/)).toBeInTheDocument()
  })

  it('shows the badge icon of a retreat on its card in place of the kind\'s symbol', () => {
    renderBrowser({ events: [{ ...event('autumn', 'virtual_retreat', '2026-10-20'), badge_icon: '💡' }] })
    expect(within(screen.getByTestId('event-art')).getByText('💡')).toBeInTheDocument()
  })

  it('takes the organization label and category off a title', () => {
    renderBrowser({ initialMonth: MONTHS[1].id, events: [{ ...event('x', 'educational', '2026-10-15'), title: 'Quill & Cup [Authorpreneurship] Prickle: A Way to Make Money' }] })
    expect(within(glance('October')).getByRole('link', { name: 'A Way to Make Money' })).toBeInTheDocument()
    expect(screen.queryByText(/Quill & Cup/)).not.toBeInTheDocument()
  })
})

describe('EventsBrowser times', () => {
  const timed = (id: string, start_time: string, end_time: string, extra: Partial<EventRow> = {}): EventRow => ({
    ...event(id, 'educational', '2026-10-20'),
    start_time,
    end_time,
    ...extra,
  })

  it('shows the time of day in the viewer\'s zone, on the card and in the month', () => {
    renderBrowser({ initialMonth: MONTHS[1].id, events: [timed('talk', '2026-10-20T18:00:00Z', '2026-10-20T19:00:00Z')] })
    expect(within(screen.getByRole('region', { name: 'Educational' })).getByText(/2 – 3 pm EDT/)).toBeInTheDocument()
    expect(within(glance('October')).getByText('2 – 3 pm EDT')).toBeInTheDocument()
  })

  it('files an evening event under the viewer\'s day, not the Eastern one', () => {
    // 8 pm Eastern on Oct 20 is already Oct 21 in UTC; the viewer in UTC sees it on the 21st at 12 am.
    renderBrowser({ initialMonth: MONTHS[1].id, timeZone: 'Asia/Tokyo', events: [timed('late', '2026-10-20T23:00:00Z', '2026-10-21T00:00:00Z')] })
    expect(within(glance('October')).getByLabelText('Wed, Oct 21')).toBeInTheDocument()
  })

  it('says nothing about time for an all-day event or one with dates only', () => {
    renderBrowser({
      initialMonth: MONTHS[1].id,
      eventPrickles: [],
      events: [
        // Midnight to midnight Eastern: all day on Oct 20.
        timed('allday', '2026-10-20T04:00:00Z', '2026-10-21T04:00:00Z'),
        event('dates', 'educational', '2026-10-22'),
      ],
    })
    const october = glance('October')
    expect(within(october).queryByText(/EDT/)).not.toBeInTheDocument()
    expect(within(october).getByLabelText('Tue, Oct 20')).toBeInTheDocument()
  })
})

describe('EventsBrowser locations', () => {
  it('leaves out Online (Zoom), since online is the default, and shows a place as typed', () => {
    const online = { ...event('talk', 'social', '2026-10-05'), location: 'https://us06web.zoom.us/j/87106462893?pwd=secret' }
    const place = { ...event('retreat', 'in_person_retreat', '2026-10-06'), location: 'Cedar Lodge' }
    renderBrowser({ initialMonth: MONTHS[1].id, events: [online, place], eventPrickles: [] })

    expect(screen.getAllByText(/Cedar Lodge/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Online/)).not.toBeInTheDocument()
    expect(screen.queryByText(/zoom\.us/)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })
})
