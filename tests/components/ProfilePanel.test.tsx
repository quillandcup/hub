// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePanel } from '@/app/(member)/settings/ProfilePanel'
import * as profileActions from '@/app/(member)/settings/profileActions'

vi.mock('@/app/(member)/settings/profileActions', () => ({
  getProfileSettings: vi.fn(),
  updateInstagramHandle: vi.fn(),
}))

const baseSettings: profileActions.ProfileSettings = {
  memberId: 'member-1',
  kajabiLinked: true,
  bio: 'Writes cozy mysteries.',
  instagramUrl: 'https://instagram.com/old_handle',
  facebookUrl: 'https://facebook.com/someone',
  twitterUrl: null,
  instagramHandle: 'old_handle',
  instagramManagedInKajabiProfile: false,
  syncPending: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProfilePanel', () => {
  it('prefills the Instagram handle and shows Kajabi-only fields read-only', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    const input = await screen.findByLabelText('Instagram handle')
    expect(input).toHaveValue('@old_handle')
    expect(screen.getByText('Writes cozy mysteries.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://facebook.com/someone' })).toHaveAttribute(
      'href',
      'https://facebook.com/someone'
    )
    // Bio isn't an input — Kajabi's API can't write it.
    expect(screen.queryByDisplayValue('Writes cozy mysteries.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'member profile' })).toHaveAttribute('href', '/members/member-1')
  })

  it('saves a new handle and shows the pending-sync message', async () => {
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
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved to Kajabi'))
    expect(await screen.findByText('Syncing to your profile…')).toBeInTheDocument()
  })

  it('validates on the client and does not call the server for a bad link', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    const input = await screen.findByLabelText('Instagram handle')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://evil.example.com/me')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent("isn't an instagram.com profile")
    expect(profileActions.updateInstagramHandle).not.toHaveBeenCalled()
  })

  it('shows the Kajabi error and keeps the typed value when the save fails', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(profileActions.updateInstagramHandle).mockResolvedValue({
      error: "Couldn't save your Instagram to Kajabi (down). Nothing was changed — please try again.",
    })

    render(<ProfilePanel />)
    const input = await screen.findByLabelText('Instagram handle')
    await userEvent.clear(input)
    await userEvent.type(input, 'new_handle')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nothing was changed'))
    expect(input).toHaveValue('new_handle')
  })

  it('makes Instagram read-only when the Kajabi profile link takes precedence', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({
      ...baseSettings,
      instagramManagedInKajabiProfile: true,
      instagramUrl: 'https://instagram.com/profile_handle',
    })
    render(<ProfilePanel />)

    expect(await screen.findByText(/takes priority/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Instagram handle')).not.toBeInTheDocument()
  })
})
