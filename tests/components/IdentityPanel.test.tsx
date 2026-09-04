// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdentityPanel } from '@/app/(member)/settings/IdentityPanel'
import * as identityActions from '@/app/(member)/settings/identityActions'

vi.mock('@/app/(member)/settings/identityActions', () => ({
  getIdentitySettings: vi.fn(),
  updateRealName: vi.fn(),
  addNameAlias: vi.fn(),
  setNameAliasActive: vi.fn(),
  addEmailAlias: vi.fn(),
  setEmailAliasActive: vi.fn(),
}))

const baseSettings = {
  realName: 'Ada Lovelace',
  primaryEmail: 'ada@example.com',
  nameAliases: [],
  emailAliases: [],
  hasAttendanceHistory: false,
}

describe('IdentityPanel', () => {
  it('does not render a status region when there is no message or error', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue(baseSettings)

    render(<IdentityPanel />)

    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument())

    // Before this fix, an empty `role="status"` div always rendered with
    // min-h-[1.25rem], reserving a blank line under the "Identity" heading.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the status region with the message once a save succeeds', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue(baseSettings)
    vi.mocked(identityActions.updateRealName).mockResolvedValue({ success: true })

    render(<IdentityPanel />)
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument())

    const input = screen.getByDisplayValue('Ada Lovelace')
    await userEvent.clear(input)
    await userEvent.type(input, 'Ada King')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Name updated.'))
  })
})
