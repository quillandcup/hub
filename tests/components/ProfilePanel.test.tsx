// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePanel } from '@/app/(member)/settings/ProfilePanel'
import * as profileActions from '@/app/(member)/settings/profileActions'
import * as pageActions from '@/app/(member)/settings/writerProfileActions'
import * as visibilityActions from '@/app/(member)/settings/profileVisibilityActions'
import { SUPPORT_EMAIL } from '@/lib/config'
import { defaultProfileVisibilities } from '@/lib/profile-visibility'
import * as milestoneActions from '@/app/(member)/settings/milestoneActions'
import type { Milestone } from '@/lib/data/milestones'

vi.mock('@/app/(member)/settings/WriterProfilePanel', () => ({
  WriterProfilePanel: ({ onTurnedOn, onTurnedOff }: { onTurnedOn?: () => void; onTurnedOff?: () => void }) => (
    <div>
      writer profile block
      <button type="button" onClick={onTurnedOn}>mock turn on</button>
      <button type="button" onClick={onTurnedOff}>mock turn off</button>
    </div>
  ),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/app/(member)/settings/milestoneActions', () => ({ setMilestoneVisibility: vi.fn() }))

vi.mock('@/app/(member)/settings/writerProfileActions', () => ({
  getMyWriterProfile: vi.fn(),
  saveWriterProfileDetails: vi.fn(),
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
  photo: { name: 'Ada Example', url: null, source: 'none', canChange: true },
  syncPending: false,
  showInRoster: true,
}

const pageSettings: pageActions.MyWriterProfile = {
  available: true,
  hasPage: true,
  handle: 'ada-example',
  isPublic: false,
  publicNameAliasId: null,
  publicBio: '',
  nameChosen: true,
  nameChoices: [{ kind: 'display', aliasId: null, label: 'Ada Example' }],
  useAccountName: false,
  suggestedHandle: 'ada-example',
  addressPrefix: 'hub.example.test/w/',
  pageUrl: 'https://hub.example.test/w/ada-example',
  previewPath: '/writer-profile/preview',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, available: false })
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

  it('shows the writer profile block only when pages on the web are open to the member', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    const { unmount } = render(<ProfilePanel />)
    await screen.findByLabelText('Bio')
    expect(screen.queryByText('writer profile block')).not.toBeInTheDocument()
    unmount()

    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue(pageSettings)
    render(<ProfilePanel />)
    expect(await screen.findByText('writer profile block')).toBeInTheDocument()
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
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue(pageSettings)
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(baseSettings)
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel />)
    await screen.findByText('writer profile block')

    await userEvent.click(await control('bio', 'Other members'))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('bio', 'public')

    await userEvent.click(await control('list of topics', 'Other members'))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('ask_me_about', 'private')
    await userEvent.click(await control('list of topics', 'Only me'))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('ask_me_about', 'community')
  })

  it('says plainly that a globe item waits for the page, and never silently', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue(pageSettings)
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({ ...baseSettings, visibilities: { ...baseSettings.visibilities, facebook: 'public' } })
    render(<ProfilePanel />)

    expect(await screen.findByTestId('note-facebook')).toHaveTextContent('Other members already see this. It goes on the web once your writer profile is on.')
  })

  it('shows no note for a globe item when the page is on, and a different one when pages on the web are closed', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, isPublic: true })
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({ ...baseSettings, visibilities: { ...baseSettings.visibilities, facebook: 'public' } })
    const { unmount } = render(<ProfilePanel />)
    await screen.findByText('writer profile block')
    expect(screen.queryByTestId('note-facebook')).not.toBeInTheDocument()
    unmount()

    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, available: false })
    render(<ProfilePanel />)
    expect(await screen.findByTestId('note-facebook')).toHaveTextContent('writer profiles are not open to you yet')
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
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, publicNameAliasId: 'nalias_1' })
    vi.mocked(pageActions.saveWriterProfileDetails).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add a different public bio' }))
    await userEvent.type(screen.getByLabelText('Public bio'), 'Written for the web.')
    await userEvent.click(screen.getByRole('button', { name: 'Save public bio' }))

    expect(pageActions.saveWriterProfileDetails).toHaveBeenCalledWith({ publicNameAliasId: 'nalias_1', bio: 'Written for the web.' })
    expect(await screen.findByText('Public bio saved.')).toBeInTheDocument()
  })

  it('shows the box already open when there is one, with no globe left on the member bio', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, publicBio: 'Already written.' })
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    expect(await screen.findByLabelText('Public bio')).toHaveValue('Already written.')
    expect(screen.getByRole('button', { name: 'Remove the separate public bio' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Who can see this bio: Other members' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Who can see this bio: Only me' }))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('bio', 'community')
  })

  it('asks before removing text, and removes it only when confirmed', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, publicBio: 'Already written.' })
    vi.mocked(pageActions.saveWriterProfileDetails).mockResolvedValue({ success: true })
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Remove the separate public bio' }))
    expect(pageActions.saveWriterProfileDetails).not.toHaveBeenCalled()
    expect(await screen.findByText('Remove the separate public bio?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove public bio' }))

    await waitFor(() => expect(pageActions.saveWriterProfileDetails).toHaveBeenCalledWith({ publicNameAliasId: null, bio: '' }))
    expect(await screen.findByText('Separate public bio removed.')).toBeInTheDocument()
  })

  it('closes an unsaved box without asking, since nothing is lost', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue(pageSettings)
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add a different public bio' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove the separate public bio' }))

    expect(screen.queryByText('Remove the separate public bio?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a different public bio' })).toBeInTheDocument()
    expect(pageActions.saveWriterProfileDetails).not.toHaveBeenCalled()
  })

  it('shows the server\'s reason when saving fails and keeps the text', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue(pageSettings)
    vi.mocked(pageActions.saveWriterProfileDetails).mockResolvedValue({ error: 'Your bio can be at most 1000 characters.' })
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add a different public bio' }))
    await userEvent.type(screen.getByLabelText('Public bio'), 'Too long')
    await userEvent.click(screen.getByRole('button', { name: 'Save public bio' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 1000')
    expect(screen.getByLabelText('Public bio')).toHaveValue('Too long')
  })
})

describe('ProfilePanel the photo row', () => {
  const withPhoto = (photo: Partial<profileActions.ProfileSettings['photo']>, level: 'private' | 'community' | 'public' = 'community') => ({
    ...baseSettings,
    visibilities: { ...baseSettings.visibilities, photo: level },
    photo: { ...baseSettings.photo, ...photo },
  })

  it('shows the picture in use, where it comes from and who sees it, with a way to change it', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(withPhoto({ url: 'https://storage.example.test/a.webp', source: 'uploaded' }, 'private'))
    render(<ProfilePanel />)

    expect(await screen.findByRole('img', { name: 'Ada Example' })).toHaveAttribute('src', 'https://storage.example.test/a.webp')
    expect(screen.getByText('A photo you uploaded.')).toBeInTheDocument()
    expect(screen.getByText('Only you see your photo; other members see your initials instead.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeInTheDocument()
  })

  it('reads the photo again after the globe is chosen on it, since a Gravatar picture is copied then, and keeps what was typed', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValueOnce(withPhoto({ url: 'https://www.gravatar.com/avatar/abc', source: 'gravatar' }))
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue(pageSettings)
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel />)
    await screen.findByText(/Your Gravatar picture/)
    await userEvent.type(screen.getByLabelText('Bio'), ' More.')

    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(withPhoto({ url: 'https://storage.example.test/g.webp', source: 'gravatar_copy' }, 'public'))
    await userEvent.click(await screen.findByRole('button', { name: /Who can see this photo/ }))

    expect(await screen.findByText('A copy of your Gravatar picture, saved here.')).toBeInTheDocument()
    expect(screen.getByLabelText('Bio')).toHaveValue('Writes cozy mysteries. More.')
  })

  it('shows the globe error and leaves the level alone', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(withPhoto({ url: 'https://www.gravatar.com/avatar/abc', source: 'gravatar' }, 'private'))
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue(pageSettings)
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ error: "We couldn't find a Gravatar picture for your email, so there is no photo to show on the web. Upload one above, then choose the globe again." })
    render(<ProfilePanel />)

    await userEvent.click(await screen.findByRole('button', { name: /Who can see this photo/ }))

    expect(await screen.findByText(/couldn't find a Gravatar picture/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Who can see this photo: Only me' })).toBeInTheDocument()
  })
})

describe('ProfilePanel: who sees what, once the writer profile is switched on', () => {
  const NOVEL = { id: 'wpr_NOVEL', title: 'A Fake Novel', phase: 'revising' }
  const milestone = (overrides: Partial<Milestone> = {}): Milestone => ({
    id: 'mlst_AAAAAAAAAAA1',
    memberId: 'member-1',
    kind: 'the_end',
    projectId: NOVEL.id,
    bookId: null,
    title: null,
    status: 'confirmed',
    source: 'member',
    achievedOn: null,
    storyBefore: null,
    storyAfter: null,
    visibility: 'public',
    consentTestimonial: false,
    confirmedAt: '2026-11-20T12:00:00Z',
    createdAt: '2026-11-20T12:00:00Z',
    ...overrides,
  })
  const settings = { ...baseSettings, photo: { ...baseSettings.photo, url: 'https://photos.example.com/ada.png' }, visibilities: { ...baseSettings.visibilities, bio: 'public' as const } }

  beforeEach(() => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue(settings)
  })

  it('shows nothing extra until the profile is switched on, then lists the name, what is filled in, the milestones and the books, each with its control', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, isPublic: true })
    render(
      <ProfilePanel
        milestones={[milestone(), milestone({ id: 'mlst_AAAAAAAAAAA2', kind: 'publish_ready', visibility: 'community' }), milestone({ id: 'mlst_AAAAAAAAAAA3', status: 'proposed', projectId: null, title: 'A Proposed Fake Work' })]}
        projects={[NOVEL]}
        books={[{ id: 'book_1', title: 'A Fake Novel Book', projectId: NOVEL.id }]}
      />,
    )
    await screen.findByText('writer profile block')
    expect(screen.queryByTestId('writer-profile-review')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'mock turn on' }))
    const review = await screen.findByTestId('writer-profile-review')
    expect(review).toHaveTextContent('Your writer profile is on. Here is who sees what.')
    expect(review).toHaveTextContent('Name: Ada Example')
    // Only what has something in it: the photo, the bio, Instagram and Facebook are set; X is empty.
    for (const key of ['photo', 'bio', 'instagram', 'facebook']) expect(within(review).getByTestId('review-item-' + key)).toBeInTheDocument()
    expect(within(review).queryByTestId('review-item-x')).not.toBeInTheDocument()
    // Confirmed milestones with their level (a proposal is not listed), and Published from the book with no control of its own.
    expect(within(review).getByTestId('review-milestone-mlst_AAAAAAAAAAA1')).toHaveTextContent('Finisher: Wrote THE END (A Fake Novel)')
    expect(within(review).getByTestId('review-milestone-mlst_AAAAAAAAAAA2')).toHaveTextContent('Author: Manuscript ready to publish')
    expect(within(review).queryByTestId('review-milestone-mlst_AAAAAAAAAAA3')).not.toBeInTheDocument()
    expect(within(review).getByTestId('review-published')).toHaveTextContent('Published Author: Published (A Fake Novel)')
    expect(within(review).getByRole('link', { name: 'View as a visitor' })).toHaveAttribute('href', '/writer-profile/preview')
  })

  it('changes an item or a milestone from the summary with the same controls, and closes with Looks good or when the profile goes off', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, isPublic: true })
    vi.mocked(visibilityActions.setProfileVisibility).mockResolvedValue({ success: true })
    vi.mocked(milestoneActions.setMilestoneVisibility).mockResolvedValue({ success: true })
    render(<ProfilePanel milestones={[milestone()]} projects={[NOVEL]} />)
    await userEvent.click(await screen.findByRole('button', { name: 'mock turn on' }))
    const review = await screen.findByTestId('writer-profile-review')

    // The bio is at the globe in this fixture: a click in the summary moves it to the lock, saved at once like the one above.
    await userEvent.click(within(within(review).getByTestId('review-item-bio')).getByRole('button', { name: /Who can see this bio/ }))
    expect(visibilityActions.setProfileVisibility).toHaveBeenLastCalledWith('bio', 'private')

    await userEvent.click(within(within(review).getByTestId('review-milestone-mlst_AAAAAAAAAAA1')).getByRole('button', { name: /Who can see this milestone: Everyone/ }))
    expect(milestoneActions.setMilestoneVisibility).toHaveBeenCalledWith('mlst_AAAAAAAAAAA1', 'private')

    await userEvent.click(within(review).getByRole('button', { name: 'Looks good' }))
    expect(screen.queryByTestId('writer-profile-review')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'mock turn on' }))
    expect(await screen.findByTestId('writer-profile-review')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'mock turn off' }))
    expect(screen.queryByTestId('writer-profile-review')).not.toBeInTheDocument()
  })

  it('says plainly when only the name is on the page, and shows a refused change as the reason', async () => {
    vi.mocked(profileActions.getProfileSettings).mockResolvedValue({ ...baseSettings, instagramUrl: null, details: { bio: null, facebookUrl: null, twitterUrl: null } })
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, isPublic: true })
    render(<ProfilePanel />)
    await userEvent.click(await screen.findByRole('button', { name: 'mock turn on' }))
    expect(await screen.findByTestId('writer-profile-review')).toHaveTextContent('Only your name is on the page so far.')
  })

  it('shows why a milestone level could not be saved, and puts the icon back', async () => {
    vi.mocked(pageActions.getMyWriterProfile).mockResolvedValue({ ...pageSettings, isPublic: true })
    vi.mocked(milestoneActions.setMilestoneVisibility).mockResolvedValue({ error: 'We could not save that.' })
    render(<ProfilePanel milestones={[milestone()]} projects={[NOVEL]} />)
    await userEvent.click(await screen.findByRole('button', { name: 'mock turn on' }))
    const review = await screen.findByTestId('writer-profile-review')
    await userEvent.click(within(review).getByRole('button', { name: /Who can see this milestone: Everyone/ }))
    expect(await within(review).findByRole('alert')).toHaveTextContent('We could not save that.')
    expect(within(review).getByRole('button', { name: /Who can see this milestone: Everyone/ })).toBeInTheDocument()
  })
})
