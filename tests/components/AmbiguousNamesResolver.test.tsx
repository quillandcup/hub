// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AmbiguousNamesResolver from '@/app/(admin)/admin/hygiene/ambiguous-names/AmbiguousNamesResolver'

const entries = [
  {
    zoomName: 'Jenn',
    occurrenceCount: 31,
    lastSeenAt: '2026-07-01T16:41:44.244006+00:00',
    candidates: [
      { id: 'm1', name: 'Jenn Powell', email: 'jenniferpowellwrites@gmail.com' },
      { id: 'm2', name: 'Jenn McGeehan', email: 'jenn@jennmcgeehan.com' },
    ],
  },
  {
    zoomName: 'Sam',
    occurrenceCount: 4,
    lastSeenAt: '2026-06-01T00:00:00.000000+00:00',
    candidates: [
      { id: 'm3', name: 'Sam Rivers', email: 'sam@example.com' },
      { id: 'm4', name: 'Samantha Lu', email: 'samantha@example.com' },
    ],
  },
]

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('AmbiguousNamesResolver', () => {
  it('renders a row per ambiguous name with candidate buttons', () => {
    render(<AmbiguousNamesResolver entries={entries} />)

    expect(screen.getByText('"Jenn"')).toBeInTheDocument()
    expect(screen.getByText(/31 occurrences/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'This is Jenn Powell' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'This is Jenn McGeehan' })).toBeInTheDocument()

    expect(screen.getByText('"Sam"')).toBeInTheDocument()
    expect(screen.getByText('unresolved ambiguous names')).toBeInTheDocument()
  })

  it('assigns a candidate and removes the row on success', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    render(<AmbiguousNamesResolver entries={entries} />)

    await userEvent.click(screen.getByRole('button', { name: 'This is Jenn Powell' }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/zoom/resolve-ambiguous',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ zoomName: 'Jenn', memberId: 'm1' }),
      })
    )

    await waitFor(() => {
      expect(screen.queryByText('"Jenn"')).not.toBeInTheDocument()
    })
    expect(screen.getByText('"Sam"')).toBeInTheDocument()
  })

  it('ignores an entry and removes the row', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    render(<AmbiguousNamesResolver entries={entries} />)

    const samRow = screen.getByText('"Sam"').closest('div.p-4') as HTMLElement
    await userEvent.click(within(samRow).getByText('Ignore'))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/zoom/resolve-ambiguous',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ zoomName: 'Sam', action: 'ignore' }),
      })
    )

    await waitFor(() => {
      expect(screen.queryByText('"Sam"')).not.toBeInTheDocument()
    })
    expect(screen.getByText('"Jenn"')).toBeInTheDocument()
  })

  it('shows an error and keeps the row when the request fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Something went wrong' }),
    })

    render(<AmbiguousNamesResolver entries={entries} />)

    await userEvent.click(screen.getByRole('button', { name: 'This is Jenn Powell' }))

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
    expect(screen.getByText('"Jenn"')).toBeInTheDocument()
  })
})
