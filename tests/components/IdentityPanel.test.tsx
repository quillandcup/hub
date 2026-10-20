// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdentityPanel } from '@/app/(member)/settings/IdentityPanel'
import * as identityActions from '@/app/(member)/settings/identityActions'
import { SUPPORT_EMAIL } from '@/lib/config'

vi.mock('@/app/(member)/settings/identityActions', () => ({
  getIdentitySettings: vi.fn(),
  updateRealName: vi.fn(),
  updateBirthday: vi.fn(),
  setDisplayName: vi.fn(),
  addNameAlias: vi.fn(),
  setNameAliasActive: vi.fn(),
  addEmailAlias: vi.fn(),
  setEmailAliasActive: vi.fn(),
}))

const baseSettings = {
  realName: 'Ada Lovelace',
  displayName: null,
  primaryEmail: 'ada@example.com',
  birthdayMonth: null,
  birthdayDay: null,
  nameAliases: [],
  emailAliases: [],
  hasAttendanceHistory: false,
  nameChangeLocked: false,
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
    const form = input.closest('form') as HTMLFormElement
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Name updated.'))
  })

  it('locks the Real Name form and points to support once the one-time change is used', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue({
      ...baseSettings,
      nameChangeLocked: true,
    })

    render(<IdentityPanel />)

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument())
    expect(screen.queryByDisplayValue('Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.getByText(SUPPORT_EMAIL)).toBeInTheDocument()
  })

  it('lets the member pick an active pen name as their display name, or go back to the real name', async () => {
    const alias = (id: string, name: string, active: boolean) => ({
      id, alias: name, source: 'member', active, createdAt: '2026-01-01',
    })
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue({
      ...baseSettings,
      nameAliases: [alias('1', 'A. Byron', true), alias('2', 'Old Pen', false)],
    })
    vi.mocked(identityActions.setDisplayName).mockResolvedValue({ success: true })

    render(<IdentityPanel />)
    const select = await screen.findByRole('combobox', { name: '' }).catch(() => null)
    const dropdown = select ?? (await screen.findByDisplayValue('Ada Lovelace (Real Name)'))
    expect(within(dropdown as HTMLElement).queryByRole('option', { name: 'Old Pen' })).not.toBeInTheDocument()

    await userEvent.selectOptions(dropdown as HTMLElement, 'A. Byron')
    await waitFor(() => expect(identityActions.setDisplayName).toHaveBeenCalledWith('A. Byron'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Display name updated.'))
  })

  it('shows the error when the display name cannot be saved', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue({
      ...baseSettings,
      displayName: 'A. Byron',
      nameAliases: [{ id: '1', alias: 'A. Byron', source: 'member', active: true, createdAt: '2026-01-01' }],
    })
    vi.mocked(identityActions.setDisplayName).mockResolvedValue({ error: 'Pick one of your active names' })

    render(<IdentityPanel />)
    const dropdown = await screen.findByDisplayValue('A. Byron')
    await userEvent.selectOptions(dropdown, 'Ada Lovelace (Real Name)')

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Pick one of your active names'))
    expect(identityActions.setDisplayName).toHaveBeenCalledWith(null)
  })
})
