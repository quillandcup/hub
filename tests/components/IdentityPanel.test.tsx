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
  setCustomDisplayName: vi.fn(),
  addNameAlias: vi.fn(),
  addEmailAlias: vi.fn(),
  resendEmailVerification: vi.fn(),
  makeEmailPrimary: vi.fn(),
  loadRecentSignIn: vi.fn(),
  sendReauthCode: vi.fn(),
  verifyReauthCode: vi.fn(),
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

  it('lets a member write their own display name, which is saved through one action', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue(baseSettings)
    vi.mocked(identityActions.setCustomDisplayName).mockResolvedValue({ success: true })

    render(<IdentityPanel />)
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument())

    expect(screen.queryByLabelText('Your own display name')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByDisplayValue('Ada Lovelace (Real Name)'), 'Write your own…')
    const input = screen.getByLabelText('Your own display name')
    await userEvent.type(input, 'River Wilde')
    await userEvent.click(within(input.closest('form') as HTMLFormElement).getByRole('button', { name: 'Save' }))

    expect(identityActions.setCustomDisplayName).toHaveBeenCalledWith('River Wilde')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Display name updated.'))
    expect(screen.queryByLabelText('Your own display name')).not.toBeInTheDocument()
  })

  it('lists active and inactive aliases without a way to deactivate or reactivate them', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue({
      ...baseSettings,
      nameAliases: [
        { id: 'n1', alias: 'Ada Pen', source: 'member', active: true, createdAt: '2026-01-01' },
        { id: 'n2', alias: 'Old Zoom Name', source: 'zoom', active: false, createdAt: '2026-01-01' },
      ],
      emailAliases: [
        { id: 'e1', aliasEmail: 'ada.old@example.com', source: 'auto_detected', active: true, createdAt: '2026-01-01', verifiedAt: null },
        { id: 'e2', aliasEmail: 'ada.zoom@example.com', source: 'zoom', active: false, createdAt: '2026-01-01', verifiedAt: null },
      ],
    })

    render(<IdentityPanel />)
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument())

    for (const label of ['Ada Pen', 'Old Zoom Name', 'ada.old@example.com', 'ada.zoom@example.com']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.queryByRole('button', { name: /deactivate|reactivate/i })).not.toBeInTheDocument()
  })

  it('offers to send a link to an unconfirmed address and to make a confirmed one primary', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue({
      ...baseSettings,
      emailAliases: [
        { id: 'e1', aliasEmail: 'ada.new@example.com', source: 'manual', active: true, createdAt: '2026-01-02', verifiedAt: null },
        { id: 'e2', aliasEmail: 'ada.old@example.com', source: 'manual', active: true, createdAt: '2026-01-01', verifiedAt: '2026-01-03' },
        { id: 'e3', aliasEmail: 'ada.off@example.com', source: 'zoom', active: false, createdAt: '2026-01-01', verifiedAt: null },
      ],
    })
    vi.mocked(identityActions.resendEmailVerification).mockResolvedValue({ success: true })
    vi.mocked(identityActions.makeEmailPrimary)
      .mockResolvedValueOnce({ error: 'Confirm that email first: open the link we sent to it.' })
      .mockResolvedValueOnce({ success: true })

    render(<IdentityPanel />)
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument())
    const user = userEvent.setup()

    // A turned-off address has no controls.
    expect(screen.getAllByRole('button', { name: /make .* my primary email|confirmation link/i })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Send ada.new@example.com a confirmation link' }))
    expect(identityActions.resendEmailVerification).toHaveBeenCalledWith('e1')
    expect(await screen.findByText(/Sent\. Open the link in that email/)).toBeInTheDocument()

    const makePrimary = screen.getByRole('button', { name: 'Make ada.old@example.com my primary email' })
    await user.click(makePrimary)
    expect(await screen.findByText('Confirm that email first: open the link we sent to it.')).toBeInTheDocument()
    await user.click(makePrimary)
    expect(identityActions.makeEmailPrimary).toHaveBeenCalledWith('e2')
    expect(await screen.findByText(/Your primary email is changed/)).toBeInTheDocument()
  })

  it('says whether the confirmation link went out when an email address is added', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue(baseSettings)
    vi.mocked(identityActions.addEmailAlias)
      .mockResolvedValueOnce({ success: true, verificationSent: true })
      .mockResolvedValueOnce({ success: true, verificationSent: false })

    render(<IdentityPanel />)
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument())
    const user = userEvent.setup()
    const input = screen.getByPlaceholderText('another-email@example.com')

    await user.type(input, 'ada.new@example.com')
    await user.click(within(input.closest('form')!).getByRole('button', { name: 'Add' }))
    expect(await screen.findByText(/We sent it a link/)).toBeInTheDocument()

    await user.type(input, 'ada.newer@example.com')
    await user.click(within(input.closest('form')!).getByRole('button', { name: 'Add' }))
    expect(await screen.findByText(/couldn't send the confirmation link/)).toBeInTheDocument()
  })

  it('asks the member to sign in again before switching the primary email, then finishes the switch', async () => {
    vi.mocked(identityActions.getIdentitySettings).mockResolvedValue({
      ...baseSettings,
      emailAliases: [{ id: 'e2', aliasEmail: 'ada.old@example.com', source: 'manual', active: true, createdAt: '2026-01-01', verifiedAt: '2026-01-03' }],
    })
    vi.mocked(identityActions.makeEmailPrimary).mockReset().mockResolvedValueOnce({ needsReauth: true }).mockResolvedValueOnce({ success: true })
    vi.mocked(identityActions.sendReauthCode).mockResolvedValue({ success: true, sentTo: 'ada@example.com' })
    vi.mocked(identityActions.verifyReauthCode).mockResolvedValue({ success: true })
    vi.mocked(identityActions.loadRecentSignIn).mockResolvedValue({ recent: false })

    render(<IdentityPanel />)
    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument())
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Make ada.old@example.com my primary email' }))
    expect(await screen.findByRole('dialog')).toHaveAccessibleName("Confirm it's you")
    expect(identityActions.makeEmailPrimary).toHaveBeenCalledTimes(1)

    await user.type(screen.getByLabelText('Sign-in code'), '12345678')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(identityActions.makeEmailPrimary).toHaveBeenCalledTimes(2))
    expect(identityActions.makeEmailPrimary).toHaveBeenLastCalledWith('e2')
    expect(await screen.findByText(/Your primary email is changed/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
