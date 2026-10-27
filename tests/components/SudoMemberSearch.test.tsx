// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SudoMemberSearch, { type SudoMember, SUDO_SEARCH_LIMIT } from '@/components/SudoMemberSearch'

const alice = { id: 'm1', name: 'Alice Example', email: 'alice@example.com' }
const penny = { id: 'm3', name: 'Penelope Legal', displayName: 'Penny Pen', email: 'penny@example.com' }
const alan = { id: 'm2', name: 'Alan Other', email: 'alan@example.com' }

function mockFetchResponse(members: SudoMember[], ok = true) {
  return { ok, status: ok ? 200 : 403, json: async () => ({ members }) }
}

function Harness({ onSelect }: { onSelect?: (m: SudoMember | null) => void }) {
  const [selected, setSelected] = useState<SudoMember | null>(null)
  return (
    <SudoMemberSearch
      selectedMember={selected}
      onSelect={(m) => {
        setSelected(m)
        onSelect?.(m)
      }}
      debounceMs={0}
    />
  )
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('SudoMemberSearch', () => {
  it('does not fetch anything until the admin types', () => {
    render(<Harness />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('leaves no close timer pending once it unmounts after a blur', () => {
    // The dropdown closes on a short delay after blur; if that timer outlives the component it fires
    // on a torn-down DOM, which failed unit-test runs at random with `window is not defined`.
    vi.useFakeTimers()
    try {
      const { unmount } = render(<Harness />)
      // Something else holds one timer from mount, so compare with that rather than with zero.
      const baseline = vi.getTimerCount()
      const input = screen.getByRole('combobox')
      fireEvent.focus(input)
      fireEvent.blur(input)
      expect(vi.getTimerCount()).toBeGreaterThan(baseline)

      unmount()

      expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queries the members endpoint with the search term and a small limit', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([alice, alan]) as any)
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('combobox'), 'al')

    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
    expect(screen.getByText('Alan Other')).toBeInTheDocument()

    const lastUrl = vi.mocked(global.fetch).mock.calls.at(-1)![0] as string
    expect(lastUrl).toBe(`/api/members?search=al&limit=${SUDO_SEARCH_LIMIT}`)
  })

  it('debounces keystrokes into a single request', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([alice]) as any)
    const user = userEvent.setup()
    render(
      <SudoMemberSearch selectedMember={null} onSelect={() => {}} debounceMs={50} />,
    )

    await user.type(screen.getByRole('combobox'), 'alice')
    await screen.findByText('Alice Example')

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain('search=alice')
  })

  it('shows a loading state while the search is in flight', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(global.fetch).mockReturnValue(new Promise((r) => { resolve = r }) as any)
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('combobox'), 'a')
    expect(await screen.findByText('Searching...')).toBeInTheDocument()

    resolve(mockFetchResponse([alice]))
    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
    expect(screen.queryByText('Searching...')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matches', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([]) as any)
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('combobox'), 'zzz')
    expect(await screen.findByText('No members found')).toBeInTheDocument()
  })

  it('shows an error when the endpoint rejects the request', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([], false) as any)
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('combobox'), 'al')
    expect(await screen.findByRole('alert')).toHaveTextContent('Search failed (403)')
  })

  it('selects a member on click and shows the selection with a clear button', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([alice, alan]) as any)
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'al')
    await user.click(await screen.findByText('Alan Other'))

    expect(onSelect).toHaveBeenCalledWith(alan)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Alan Other')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('supports arrow-key navigation and Enter to select', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([alice, alan]) as any)
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'al')
    await screen.findByText('Alice Example')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(alan))
  })

  it('shows only the display name, and hands back the whole member when picked', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([penny, alice]) as any)
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'pen')

    expect(await screen.findByText('Penny Pen')).toBeInTheDocument()
    expect(screen.queryByText(/Penelope Legal/)).not.toBeInTheDocument() // the legal name isn't why it matched
    expect(screen.queryByText(/penny@example.com/)).not.toBeInTheDocument()

    await user.click(screen.getByText('Penny Pen'))
    expect(onSelect).toHaveBeenCalledWith(penny) // with the real email
  })

  it('says why when the match is not in the name shown: legal name, email or nickname', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('combobox')

    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([penny]) as any)
    await user.type(input, 'penelope')
    expect(await screen.findByText('Penelope Legal')).toBeInTheDocument()

    await user.clear(input)
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([penny]) as any)
    await user.type(input, 'penny@ex')
    expect(await screen.findByText('penny@example.com')).toBeInTheDocument()

    await user.clear(input)
    vi.mocked(global.fetch).mockResolvedValue(mockFetchResponse([{ ...penny, matchedAlias: 'Quillfoot' }]) as any)
    await user.type(input, 'quillfoot')
    expect(await screen.findByText('also known as “Quillfoot”')).toBeInTheDocument()
  })
})
