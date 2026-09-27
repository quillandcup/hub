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
}))

const baseSettings: profileActions.ProfileSettings = {
  memberId: 'member-1',
  kajabiLinked: true,
  instagramHandle: 'old_handle',
  instagramFallbackUrl: null,
  details: { bio: 'Writes cozy mysteries.', facebookUrl: 'https://facebook.com/someone', twitterUrl: null },
  detailFallbacks: { bio: 'Writes cozy mysteries.', facebookUrl: null, twitterUrl: null },
  syncPending: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProfilePanel', () => {
  it('prefills every editable field and never points members to Kajabi', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    expect(await screen.findByLabelText('Instagram handle')).toHaveValue('@old_handle')
    expect(screen.getByLabelText('Bio')).toHaveValue('Writes cozy mysteries.')
    expect(screen.getByLabelText('Facebook')).toHaveValue('https://facebook.com/someone')
    expect(screen.getByLabelText('X / Twitter')).toHaveValue('')
    expect(screen.getByRole('link', { name: 'member profile' })).toHaveAttribute('href', '/members/member-1')
    expect(screen.queryByText(/Kajabi/)).not.toBeInTheDocument()
  })

  it('explains the fallback when a blank field would show the previous value', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    expect(await screen.findByText(/your profile shows your previous bio instead/)).toBeInTheDocument()
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

  it('saves a new Instagram handle separately', async () => {
    vi.mocked(profileActions.getProfileSettings)
      .mockResolvedValueOnce(baseSettings)
      .mockResolvedValueOnce({ ...baseSettings, instagramHandle: 'new_handle', syncPending: true })
    vi.mocked(profileActions.updateInstagramHandle).mockResolvedValue({ success: true, syncPending: true })

    render(<ProfilePanel />)
    const input = await screen.findByLabelText('Instagram handle')
    await userEvent.clear(input)
    await userEvent.type(input, '@new_handle')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(profileActions.updateInstagramHandle).toHaveBeenCalledWith('@new_handle')
    expect(profileActions.updateProfileDetails).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'))
  })

  it('rejects a non-Instagram link client-side', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    const input = await screen.findByLabelText('Instagram handle')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://evil.example.com/me')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent("doesn't go to a profile on instagram.com")
    expect(profileActions.updateInstagramHandle).not.toHaveBeenCalled()
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
    expect(screen.getByRole('link', { name: 'support@quillandcup.com' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Instagram handle')).not.toBeInTheDocument()
  })
})
