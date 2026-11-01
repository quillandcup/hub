// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PastEventsBrowser from '@/app/(member)/events/past/PastEventsBrowser'
import type { EventRow } from '@/app/(member)/events/AgendaList'
import { monthsBetween } from '@/lib/events-agenda'
import type { EventPrickle } from '@/lib/event-prickles'

function event(id: string, starts_at: string, ends_at = starts_at): EventRow {
  return { id, slug: id, title: `Event ${id}`, event_type: 'social', location: null, starts_at, ends_at, focus: null, cover_photo_id: null }
}

const prickle = (id: string, title: string, day: string, calendarEventId: string | null = null): EventPrickle => ({
  id, title, typeName: 'Pitch Prickle', hostName: null, calendarEventId, startTime: `${day}T18:00:00Z`, endTime: `${day}T19:00:00Z`,
})

const EVENTS = [event('a', '2026-10-03'), event('b', '2026-10-17'), event('c', '2026-03-07'), event('d', '2024-11-02'), event('e', '2022-01-29', '2022-01-30')]
const MONTHS = monthsBetween('2022-01-29', '2026-10-20')

const bodies: Record<string, EventPrickle[]> = {
  '2026-10': [prickle('p-oct', 'October Pitch', '2026-10-09')],
  '2026-09': [prickle('p-sep', 'September Pitch', '2026-09-11'), prickle('p-followed', 'Followed Pitch', '2026-09-18', 'cal-1')],
  '2026-08': [prickle('p-aug', 'August Pitch', '2026-08-14')],
  '2026-03': [prickle('p-mar', 'March Pitch', '2026-03-13')],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.history.replaceState(null, '', '/events/past')
  fetchMock = vi.fn(async (url: string) => {
    const id = new URL(url, 'http://x').searchParams.get('month')!
    return { ok: true, json: async () => ({ prickles: bodies[id] ?? [] }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const renderBrowser = (initialMonth = '2026-10', events = EVENTS, months = MONTHS) =>
  render(<PastEventsBrowser initialMonth={initialMonth} months={months} events={events} eventPrickleIds={['p-followed']} initialPrickles={bodies[initialMonth] ?? []} timeZone="America/New_York" />)

const calls = () => fetchMock.mock.calls.map(([url]) => new URL(url as string, 'http://x').searchParams.get('month'))

describe('PastEventsBrowser', () => {
  it('opens on the month it is given: its events and its sessions, together by day', () => {
    renderBrowser()
    const october = screen.getByRole('region', { name: 'October 2026' })
    expect(within(october).getByRole('link', { name: /Event a/ })).toHaveAttribute('href', '/events/a')
    expect(within(october).getByRole('link', { name: /Event b/ })).toBeInTheDocument()
    expect(within(october).getByRole('link', { name: /October Pitch/ })).toHaveAttribute('href', '/prickles/p-oct')
    expect(screen.queryByText('Event c')).not.toBeInTheDocument()
  })

  it('offers a year pill for every year back, newest first, and all the months of the open year', () => {
    renderBrowser()
    expect(within(screen.getByRole('group', { name: 'Year' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['2026', '2025', '2024', '2023', '2022'])
    expect(within(screen.getByRole('group', { name: 'Month' })).getAllByRole('button').map((b) => b.textContent)).toEqual(
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'],
    )
  })

  it('fetches the months either side of the open one ahead of time, so paging is instant', async () => {
    renderBrowser()
    await waitFor(() => expect(calls()).toContain('2026-09'))
    expect(calls()).not.toContain('2026-10') // came with the page
    await userEvent.click(within(screen.getByRole('group', { name: 'Month' })).getByRole('button', { name: 'September' }))
    expect(within(screen.getByRole('region', { name: 'September 2026' })).getByRole('link', { name: /September Pitch/ })).toBeInTheDocument()
    expect(screen.queryByText('Loading sessions…')).not.toBeInTheDocument()
    await waitFor(() => expect(calls()).toContain('2026-08')) // and the next one back
    expect(window.location.search).toBe('?month=2026-09')
  })

  it('starts fetching a month when someone points at its pill, once', async () => {
    renderBrowser()
    const march = within(screen.getByRole('group', { name: 'Month' })).getByRole('button', { name: 'March' })
    await userEvent.hover(march)
    await waitFor(() => expect(calls()).toContain('2026-03'))
    await userEvent.unhover(march)
    await userEvent.hover(march)
    expect(calls().filter((m) => m === '2026-03')).toHaveLength(1)
    await userEvent.click(march)
    expect(within(screen.getByRole('region', { name: 'March 2026' })).getByRole('link', { name: /March Pitch/ })).toBeInTheDocument()
    expect(screen.getByText('Event c')).toBeInTheDocument()
  })

  it('also fetches for a year pill, and opens that year\'s latest month', async () => {
    renderBrowser()
    await userEvent.click(within(screen.getByRole('group', { name: 'Year' })).getByRole('button', { name: '2022' }))
    expect(screen.getByRole('region', { name: 'December 2022' })).toBeInTheDocument()
    expect(window.location.search).toBe('?month=2022-12')
  })

  it('leaves out a session whose event follows it, and says when a month has nothing', async () => {
    renderBrowser('2026-09')
    expect(screen.getByRole('link', { name: /September Pitch/ })).toBeInTheDocument()
    expect(screen.queryByText(/Followed Pitch/)).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Month' })).getByRole('button', { name: 'July' }))
    expect(await screen.findByText('Nothing in July 2026.')).toBeInTheDocument()
  })

  it('shows the events at once while a month\'s sessions load, then the sessions', async () => {
    const pending: ((value: unknown) => void)[] = []
    fetchMock.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    renderBrowser('2026-10')
    await userEvent.click(within(screen.getByRole('group', { name: 'Year' })).getByRole('button', { name: '2024' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Month' })).getByRole('button', { name: 'November' }))
    expect(screen.getByText('Event d')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading sessions…')
    for (const release of pending) release({ ok: true, json: async () => ({ prickles: [] }) })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('says when sessions could not be loaded, and tries again', async () => {
    let down = true
    const works = fetchMock.getMockImplementation()! as (url: string) => unknown
    fetchMock.mockImplementation(async (url: string) => (down && url.includes('2026-03') ? { ok: false, status: 500, json: async () => ({}) } : works(url)))
    renderBrowser('2026-10')
    await userEvent.click(within(screen.getByRole('group', { name: 'Month' })).getByRole('button', { name: 'March' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the sessions.")
    expect(screen.getByText('Event c')).toBeInTheDocument() // the events are there regardless
    down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: /March Pitch/ })).toBeInTheDocument()
  })

  it('says so when there are no months', () => {
    renderBrowser('2026-10', [], [])
    expect(screen.getByText('No past events yet.')).toBeInTheDocument()
  })
})
