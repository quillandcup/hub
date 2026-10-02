// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePanel } from '@/app/(member)/settings/ProfilePanel'
import * as profileActions from '@/app/(member)/settings/profileActions'

vi.mock('@/app/(member)/settings/profileActions', () => ({
  getProfileSettings: vi.fn(),
  updateInstagramHandle: vi.fn(),
  updateProfileDetails: vi.fn(),
  updateAskMeAbout: vi.fn(),
}))

const baseSettings: profileActions.ProfileSettings = {
  memberId: 'member-1',
  kajabiLinked: true,
  instagramHandle: 'old_handle',
  instagramFallbackUrl: null,
  details: { bio: 'Writes cozy mysteries.', facebookUrl: 'https://facebook.com/someone', twitterUrl: null },
  askMeAbout: ['cozy mysteries'],
  syncPending: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProfilePanel', () => {
  it('prefills every editable field and never points members to Kajabi', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    expect(await screen.findByLabelText('Instagram')).toHaveValue('@old_handle')
    expect(screen.getByLabelText('Bio')).toHaveValue('Writes cozy mysteries.')
    expect(screen.getByLabelText('Facebook')).toHaveValue('https://facebook.com/someone')
    expect(screen.getByLabelText('X / Twitter')).toHaveValue('')
    expect(screen.getByRole('link', { name: 'member profile' })).toHaveAttribute('href', '/members/member-1')
    expect(screen.queryByText(/Kajabi/)).not.toBeInTheDocument()
  })

  it('makes clearing obvious: a hide hint on each field and a Remove button that empties it for saving', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(profileActions.updateProfileDetails).mockResolvedValue({ success: true, syncPending: true })
    render(<ProfilePanel />)

    expect(await screen.findByText('Leave blank to hide your bio from your profile.')).toBeInTheDocument()
    expect(screen.queryByText(/previous/)).not.toBeInTheDocument()
    // X is already empty, so it has no Remove button.
    expect(screen.queryByRole('button', { name: 'Remove X link' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove bio' }))
    expect(screen.getByLabelText('Bio')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Remove bio' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(profileActions.updateProfileDetails).toHaveBeenCalledWith({
      bio: '',
      facebook: 'https://facebook.com/someone',
      x: '',
    })
  })

  it('saves bio / Facebook / X together and shows the pending-sync state', async () => {
    vi.mocked(profileActions.getProfileSettings)
      .mockResolvedValueOnce(baseSettings)
      .mockResolvedValueOnce({
        ...baseSettings,
        details: { bio: 'New bio', facebookUrl: 'https://facebook.com/someone', twitterUrl: 'https://x.com/hedgie' },
        syncPending: true,
      })
    vi.mocked(profileActions.updateProfileDetails).mockResolvedValue({ success: true, syncPending: true })

    render(<ProfilePanel />)
    const bio = await screen.findByLabelText('Bio')
    await userEvent.clear(bio)
    await userEvent.type(bio, 'New bio')
    await userEvent.type(screen.getByLabelText('X / Twitter'), '@hedgie')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(profileActions.updateProfileDetails).toHaveBeenCalledWith({
      bio: 'New bio',
      facebook: 'https://facebook.com/someone',
      x: '@hedgie',
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved. Your profile will update'))
    expect(await screen.findByText('Syncing to your profile…')).toBeInTheDocument()
    expect(profileActions.updateInstagramHandle).not.toHaveBeenCalled()
  })

  it('validates bio / social links on the client before calling the server', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    const x = await screen.findByLabelText('X / Twitter')
    await userEvent.type(x, 'https://evil.example.com/me')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(screen.getByRole('status')).toHaveTextContent("X: That link doesn't go to a profile on x.com")
    expect(profileActions.updateProfileDetails).not.toHaveBeenCalled()
  })

  it('saves a new Instagram handle with the same Save button as the other fields', async () => {
    vi.mocked(profileActions.getProfileSettings)
      .mockResolvedValueOnce(baseSettings)
      .mockResolvedValueOnce({ ...baseSettings, instagramHandle: 'new_handle', syncPending: true })
    vi.mocked(profileActions.updateInstagramHandle).mockResolvedValue({ success: true, syncPending: true })
    vi.mocked(profileActions.updateProfileDetails).mockResolvedValue({ success: true, syncPending: false })

    render(<ProfilePanel />)
    const input = await screen.findByLabelText('Instagram')
    await userEvent.clear(input)
    await userEvent.type(input, '@new_handle')
    expect(screen.getAllByRole('button', { name: /save/i })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(profileActions.updateInstagramHandle).toHaveBeenCalledWith('@new_handle')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved. Your profile will update'))
  })

  it('surfaces the Kajabi warning when Instagram saved but the profile refresh lagged', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(profileActions.updateInstagramHandle).mockResolvedValue({
      success: true,
      syncPending: true,
      warning: 'Saved. It may take until tomorrow to show on your profile.',
    })
    vi.mocked(profileActions.updateProfileDetails).mockResolvedValue({ success: true, syncPending: false })

    render(<ProfilePanel />)
    const input = await screen.findByLabelText('Instagram')
    await userEvent.clear(input)
    await userEvent.type(input, '@new_handle')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('until tomorrow'))
  })

  it('rejects a non-Instagram link client-side', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    const input = await screen.findByLabelText('Instagram')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://evil.example.com/me')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(screen.getByRole('status')).toHaveTextContent("Instagram: That link doesn't go to a profile on instagram.com")
    expect(profileActions.updateInstagramHandle).not.toHaveBeenCalled()
    expect(profileActions.updateProfileDetails).not.toHaveBeenCalled()
  })

  it('shows the server error and keeps typed values when a save fails', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(profileActions.updateProfileDetails).mockResolvedValue({
      error: "Couldn't save your profile — please try again.",
    })

    render(<ProfilePanel />)
    const bio = await screen.findByLabelText('Bio')
    await userEvent.clear(bio)
    await userEvent.type(bio, 'Draft bio')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Couldn't save your profile"))
    expect(bio).toHaveValue('Draft bio')
  })

  it('still lets unlinked members edit bio and links, with support pointer for Instagram', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({
      ...baseSettings,
      kajabiLinked: false,
      instagramHandle: null,
    })
    render(<ProfilePanel />)

    expect(await screen.findByLabelText('Bio')).toBeEnabled()
    expect(screen.getByRole('link', { name: 'support@example.com' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Instagram')).not.toBeInTheDocument()
  })

  it('adds and removes "Ask me about" topics as chips and saves only when they changed', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(profileActions.updateProfileDetails).mockResolvedValue({ success: true, syncPending: false })
    vi.mocked(profileActions.updateAskMeAbout).mockResolvedValue({ success: true, syncPending: false })
    render(<ProfilePanel />)

    const input = await screen.findByLabelText('Ask me about…')
    expect(screen.getByText('cozy mysteries')).toBeInTheDocument()
    await userEvent.type(input, 'querying agents{Enter}Worldbuilding,cozy MYSTERIES,')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Worldbuilding' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(profileActions.updateAskMeAbout).toHaveBeenCalledWith(['cozy mysteries', 'querying agents'])
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved\.$/))
  })

  it('does not call the topics action when the topics are unchanged', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(profileActions.updateProfileDetails).mockResolvedValue({ success: true, syncPending: false })
    render(<ProfilePanel />)

    await screen.findByLabelText('Ask me about…')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No changes to save.'))
    expect(profileActions.updateAskMeAbout).not.toHaveBeenCalled()
  })
})
