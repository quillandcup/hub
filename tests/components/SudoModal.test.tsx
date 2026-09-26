// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const startSudo = vi.fn()
vi.mock('@/app/actions/sudo', () => ({ startSudo: (...args: unknown[]) => startSudo(...args) }))

// Stand-in picker: the real one is covered by SudoMemberSearch.test.tsx.
vi.mock('@/components/SudoMemberSearch', () => ({
  default: ({ onSelect }: { onSelect: (m: { id: string; name: string; email: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ id: 'm1', name: 'Alice', email: 'alice@example.com' })}>
      pick alice
    </button>
  ),
}))

import SudoModal from '@/components/SudoModal'

describe('SudoModal', () => {
  const originalUrl = window.location.href

  beforeEach(() => {
    startSudo.mockReset()
    startSudo.mockResolvedValue(undefined)
  })

  afterEach(() => {
    window.history.replaceState(null, '', originalUrl)
  })

  it('starts sudo with the current page (path, search and hash) as the landing target', async () => {
    window.history.replaceState(null, '', '/calendar?view=week#today')
    render(<SudoModal isOpen onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'pick alice' }))
    await userEvent.click(screen.getByRole('button', { name: 'View As Member' }))

    expect(startSudo).toHaveBeenCalledWith('m1', '/calendar?view=week#today')
  })

  it('does not start sudo until a member is selected', () => {
    render(<SudoModal isOpen onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'View As Member' })).toBeDisabled()
    expect(startSudo).not.toHaveBeenCalled()
  })
})
