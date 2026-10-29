// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PastEventsBrowser from '@/app/(member)/events/past/PastEventsBrowser'
import type { EventRow } from '@/app/(member)/events/AgendaList'

function event(id: string, starts_at: string, ends_at = starts_at): EventRow {
  return { id, slug: id, title: `Event ${id}`, event_type: 'social', location: null, starts_at, ends_at, focus: null, cover_photo_id: null }
}

const EVENTS = [
  event('a', '2026-10-03'),
  event('b', '2026-10-17'),
  event('c', '2026-03-07'),
  event('d', '2024-11-02'),
  event('e', '2022-01-29', '2022-01-30'),
]

const renderBrowser = (initialMonth: string | null = null, events = EVENTS) =>
  render(<PastEventsBrowser initialMonth={initialMonth} events={events} timeZone="America/New_York" />)

describe('PastEventsBrowser', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/events/past')
  })

  it('opens on the most recent month with past events, with a year pill for every year back', () => {
    renderBrowser()
    expect(within(screen.getByRole('group', { name: 'Year' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^2026/), expect.stringMatching(/^2024/), expect.stringMatching(/^2022/),
    ])
    const october = screen.getByRole('region', { name: 'October 2026' })
    expect(within(october).getByRole('link', { name: /Event a/ })).toHaveAttribute('href', '/events/a')
    expect(within(october).getByRole('link', { name: /Event b/ })).toBeInTheDocument()
    expect(screen.queryByText('Event c')).not.toBeInTheDocument()
  })

  it('offers only the months of the chosen year that have events, oldest first', () => {
    renderBrowser()
    expect(within(screen.getByRole('group', { name: 'Month' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^March/), expect.stringMatching(/^October/),
    ])
  })

  it('goes to an earlier year, to its latest month, and syncs ?month=', async () => {
    renderBrowser()
    await userEvent.click(within(screen.getByRole('group', { name: 'Year' })).getByRole('button', { name: /^2022/ }))
    expect(screen.getByRole('region', { name: 'January 2022' })).toBeInTheDocument()
    expect(screen.getByText('Event e')).toBeInTheDocument()
    expect(window.location.search).toBe('?month=2022-01')
  })

  it('opens on the month named in the link, and ignores one with nothing in it', () => {
    renderBrowser('2026-03')
    expect(screen.getByRole('region', { name: 'March 2026' })).toBeInTheDocument()
    expect(screen.getByText('Event c')).toBeInTheDocument()
  })

  it('falls back to the latest month for a month with no past events', () => {
    renderBrowser('2026-07')
    expect(screen.getByRole('region', { name: 'October 2026' })).toBeInTheDocument()
  })

  it('says so when there are no past events', () => {
    renderBrowser(null, [])
    expect(screen.getByText('No past events yet.')).toBeInTheDocument()
  })
})
