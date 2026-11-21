// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePanel } from '@/app/(member)/settings/ProfilePanel'
import * as profileActions from '@/app/(member)/settings/profileActions'
import * as pageActions from '@/app/(member)/settings/writerPageActions'
import * as visibilityActions from '@/app/(member)/settings/profileVisibilityActions'
import { SUPPORT_EMAIL } from '@/lib/config'
import { defaultProfileVisibilities } from '@/lib/profile-visibility'

vi.mock('@/app/(member)/settings/WriterPagePanel', () => ({ WriterPagePanel: () => <div>writer page block</div> }))

vi.mock('@/app/(member)/settings/writerPageActions', () => ({
  getWriterPageSettings: vi.fn(),
  saveWriterPageDetails: vi.fn(),
}))

vi.mock('@/app/(member)/settings/profileVisibilityActions', () => ({ setProfileVisibility: vi.fn() }))

vi.mock('@/app/(member)/settings/profileActions', () => ({
  getProfileSettings: vi.fn(),
  updateInstagramHandle: vi.fn(),
  updateProfileDetails: vi.fn(),
  updateAskMeAbout: vi.fn(),
}))

const baseSettings: profileActions.ProfileSettings = {
  memberId: 'member-1',
  kajabiLinked: true,
  instagramUrl: 'https://instagram.com/old_handle',
  details: { bio: 'Writes cozy mysteries.', facebookUrl: 'https://facebook.com/someone', twitterUrl: null },
  askMeAbout: ['cozy mysteries'],
  visibilities: defaultProfileVisibilities(),
  syncPending: false,
  showInRoster: true,
}

const pageSettings: pageActions.WriterPageSettings = {
  available: true,
  hasPage: true,
  handle: 'ada-example',
  isPublic: false,
  publicNameAliasId: null,
  publicBio: '',
  nameChosen: true,
  nameChoices: [{ aliasId: null, label: 'Ada Example' }],
  photoAvailable: true,
  suggestedHandle: 'ada-example',
  addressPrefix: 'hub.example.test/w/',
  usingAccountName: false,
  pageUrl: 'https://hub.example.test/w/ada-example',
  previewPath: '/writer-page/preview',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue({ ...pageSettings, available: false })
})

describe('ProfilePanel', () => {
  it('prefills every editable field and never points members to Kajabi', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    expect(await screen.findByLabelText('Instagram')).toHaveValue('https://instagram.com/old_handle')
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
      .mockResolvedValueOnce({ ...baseSettings, instagramUrl: 'https://instagram.com/new_handle', syncPending: true })
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
      instagramUrl: null,
    })
    render(<ProfilePanel />)

    expect(await screen.findByLabelText('Bio')).toBeEnabled()
    expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toBeInTheDocument()
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

describe('ProfilePanel one section', () => {
  it('has one Profile heading, none that says Public Profile, and no Who\'s coming (it moved to Preferences)', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByText('Public Profile')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Who's coming/ })).not.toBeInTheDocument()
  })

  it('shows the writer page block only when pages on the web are open to the member', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    const { unmount } = render(<ProfilePanel />)
    await screen.findByLabelText('Bio')
    expect(screen.queryByText('writer page block')).not.toBeInTheDocument()
    unmount()

    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue(pageSettings)
    render(<ProfilePanel />)
    expect(await screen.findByText('writer page block')).toBeInTheDocument()
  })
})

describe('ProfilePanel who can see each item', () => {
  const control = (item: string, level: string) => screen.findByRole('button', { name: `Who can see this ${item}: ${level}` })

  it('has a control on the photo, bio, topics and each social link, all at "Other members" by default', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    render(<ProfilePanel />)

    for (const item of ['photo', 'bio', 'list of topics', 'Instagram link', 'Facebook link', 'X link']) {
      expect(await control(item, 'Other members')).toBeInTheDocument()
    }
  })

  it('saves a click at once, shows it, and does not need the form\'s Save', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    await userEvent.click(await control('bio', 'Other members'))

    expect(visibilityActions.setProfileVisibility).toHaveBeenCalledWith('bio', 'private')
    expect(await control('bio', 'Only me')).toBeInTheDocument()
    expect(profileActions.updateProfileDetails).not.toHaveBeenCalled()
  })

  it('goes back to the old level and says why when the save fails', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ error: "Couldn't save that — please try again." })
    render(<ProfilePanel />)

    await userEvent.click(await control('Instagram link', 'Other members'))

    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save that")
    expect(await control('Instagram link', 'Other members')).toBeInTheDocument()
  })

  it('has no globe while pages on the web are closed to the member: private and members only', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    await userEvent.click(await control('bio', 'Other members'))
    await userEvent.click(await control('bio', 'Only me'))

    expect(visibilityActions.setProfileVisibility).toHaveBeenNthCalledWith(1, 'bio', 'private')
    expect(visibilityActions.setProfileVisibility).toHaveBeenNthCalledWith(2, 'bio', 'community')
  })

  it('offers the globe on the bio, photo and social links, but never on "Ask me about"', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue(pageSettings)
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel />)
    await screen.findByText('writer page block')

    await userEvent.click(await control('bio', 'Other members'))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('bio', 'public')

    await userEvent.click(await control('list of topics', 'Other members'))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('ask_me_about', 'private')
    await userEvent.click(await control('list of topics', 'Only me'))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('ask_me_about', 'community')
  })

  it('says plainly that a globe item waits for the page, and never silently', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue(pageSettings)
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({ ...baseSettings, visibilities: { ...baseSettings.visibilities, facebook: 'public' } })
    render(<ProfilePanel />)

    expect(await screen.findByTestId('note-facebook')).toHaveTextContent('Shown on the web once your writer page is on.')
  })

  it('shows no note for a globe item when the page is on, and a different one when pages on the web are closed', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue({ ...pageSettings, isPublic: true })
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({ ...baseSettings, visibilities: { ...baseSettings.visibilities, facebook: 'public' } })
    const { unmount } = render(<ProfilePanel />)
    await screen.findByText('writer page block')
    expect(screen.queryByTestId('note-facebook')).not.toBeInTheDocument()
    unmount()

    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue({ ...pageSettings, available: false })
    render(<ProfilePanel />)
    expect(await screen.findByTestId('note-facebook')).toHaveTextContent('pages on the web are not open to you yet')
  })

  it('says a Gravatar picture is never published when the photo is set to the globe but cannot be', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue({ ...pageSettings, photoAvailable: false })
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({ ...baseSettings, visibilities: { ...baseSettings.visibilities, photo: 'public' } })
    render(<ProfilePanel />)

    expect(await screen.findByTestId('note-photo')).toHaveTextContent('Gravatar')
  })
})

describe('ProfilePanel a different public bio', () => {
  beforeEach(() => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
  })

  it('has no link to add one while pages on the web are closed to the member', async () => {
    render(<ProfilePanel />)
    await screen.findByLabelText('Bio')
    expect(screen.queryByRole('button', { name: 'Add a different public bio' })).not.toBeInTheDocument()
  })

  it('opens a second box on the link, and saves it for the page with the name left as it was', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue({ ...pageSettings, publicNameAliasId: 'nalias_1' })
    vi.mocked(pageActions.saveWriterPageDetails).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add a different public bio' }))
    await userEvent.type(screen.getByLabelText('Public bio'), 'Written for the web.')
    await userEvent.click(screen.getByRole('button', { name: 'Save public bio' }))

    expect(pageActions.saveWriterPageDetails).toHaveBeenCalledWith({ publicNameAliasId: 'nalias_1', bio: 'Written for the web.' })
    expect(await screen.findByText('Public bio saved.')).toBeInTheDocument()
  })

  it('shows the box already open when there is one, with no globe left on the member bio', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue({ ...pageSettings, publicBio: 'Already written.' })
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    expect(await screen.findByLabelText('Public bio')).toHaveValue('Already written.')
    expect(screen.getByRole('button', { name: 'Remove the separate public bio' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Who can see this bio: Other members' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Who can see this bio: Only me' }))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('bio', 'community')
  })

  it('asks before removing text, and removes it only when confirmed', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue({ ...pageSettings, publicBio: 'Already written.' })
    vi.mocked(pageActions.saveWriterPageDetails).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Remove the separate public bio' }))
    expect(pageActions.saveWriterPageDetails).not.toHaveBeenCalled()
    expect(await screen.findByText('Remove the separate public bio?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove public bio' }))

    await waitFor(() => expect(pageActions.saveWriterPageDetails).toHaveBeenCalledWith({ publicNameAliasId: null, bio: '' }))
    expect(await screen.findByText('Separate public bio removed.')).toBeInTheDocument()
  })

  it('closes an unsaved box without asking, since nothing is lost', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue(pageSettings)
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add a different public bio' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove the separate public bio' }))

    expect(screen.queryByText('Remove the separate public bio?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a different public bio' })).toBeInTheDocument()
    expect(pageActions.saveWriterPageDetails).not.toHaveBeenCalled()
  })

  it('shows the server\'s reason when saving fails and keeps the text', async () => {
    vi.mocked(pageActions.getWriterPageSettings).mockResolvedValue(pageSettings)
    vi.mocked(pageActions.saveWriterPageDetails).mockResolvedValue({ error: 'Your bio can be at most 1000 characters.' })
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add a different public bio' }))
    await userEvent.type(screen.getByLabelText('Public bio'), 'Too long')
    await userEvent.click(screen.getByRole('button', { name: 'Save public bio' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 1000')
    expect(screen.getByLabelText('Public bio')).toHaveValue('Too long')
  })
})
