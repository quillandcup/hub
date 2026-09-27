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
  instagramHandle: 'old_handle',
  instagramFallbackUrl: null,
  syncPending: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProfilePanel', () => {
  it('prefills the Instagram handle and only shows fields the member can edit', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    const input = await screen.findByLabelText('Instagram handle')
    expect(input).toHaveValue('@old_handle')
    expect(screen.getByText(/Leave blank to remove it/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'member profile' })).toHaveAttribute('href', '/members/member-1')
    // No read-only bio/Facebook/X, and no "go edit it in Kajabi" detour.
    expect(screen.queryByText(/Bio/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Facebook/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Kajabi/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('explains what a blank handle falls back to when there is a directory Instagram', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({
      ...baseSettings,
      instagramFallbackUrl: 'https://instagram.com/profile_handle',
    })
    render(<ProfilePanel />)

    expect(await screen.findByText(/If you leave it blank, your profile links to https:\/\/instagram.com\/profile_handle/)).toBeInTheDocument()
    expect(screen.getByLabelText('Instagram handle')).toBeEnabled()
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
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved. Your profile will update'))
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

  it('shows the error and keeps the typed value when the save fails', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(profileActions.updateInstagramHandle).mockResolvedValue({
      error: "Couldn't save your Instagram (down). Nothing was changed — please try again.",
    })

    render(<ProfilePanel />)
    const input = await screen.findByLabelText('Instagram handle')
    await userEvent.clear(input)
    await userEvent.type(input, 'new_handle')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nothing was changed'))
    expect(input).toHaveValue('new_handle')
  })

  it('points unlinked members to support instead of showing a form', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({
      ...baseSettings,
      kajabiLinked: false,
      instagramHandle: null,
    })
    render(<ProfilePanel />)

    expect(await screen.findByRole('link', { name: 'support@quillandcup.com' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Instagram handle')).not.toBeInTheDocument()
  })
})
