// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PreviewsClient from '@/app/(admin)/admin/previews/PreviewsClient'

const FLAG = { key: 'events', name: 'Events', enabledGlobally: false, segments: [] }
const user = (id: string, email: string, features: string[], memberName: string | null = null, memberDisplayName: string | null = null) => ({
  id,
  email,
  features,
  memberName,
  memberDisplayName,
  staffName: null,
})

let users: ReturnType<typeof user>[]
let fetchMock: ReturnType<typeof vi.fn>

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)

beforeEach(() => {
  users = [
    user('u1', 'ada@example.test', ['events'], 'Ada Example', 'Penny Quill'),
    user('u2', 'bea@example.test', [], 'Bea Example'),
  ]
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/admin/segments') return json({ segments: [{ id: 'seg1', name: 'Spring', memberCount: 0, created_at: '2027-01-01T00:00:00Z' }] })
    if (url === '/api/admin/segments/seg1') return json({ segment: { id: 'seg1', name: 'Spring' }, members: [] })
    if (url === '/api/admin/segments/sources') return json({ sources: [{ type: 'course', id: 'c1', name: 'Course One' }] })
    if (url === '/api/admin/segments/seg1/sync' && init?.method === 'POST') return json({ summary: { found: 3, added: 2, already_in_segment: 1 } })
    if (url === '/api/admin/feature-flags') return json({ flags: [FLAG] })
    if (url === '/api/admin/users') return json({ users })
    if (url.startsWith('/api/admin/users/') && init?.method === 'PATCH') return json({ success: true })
    return json({ error: 'unexpected' }, false)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([url, init]) => [url, JSON.parse(init!.body as string)])

describe('PreviewsClient per-person previews', () => {
  it('lists the people a flag is on for, by the name they go by', async () => {
    render(<PreviewsClient allMembers={[]} />)
    await screen.findByText('Penny Quill')
    expect(screen.queryByText('Bea Example')).not.toBeInTheDocument()
  })

  it('turns a flag off for one person, keeping their other previews', async () => {
    users[0].features = ['events', 'work_queue']
    const u = userEvent.setup()
    render(<PreviewsClient allMembers={[]} />)
    await u.click(await screen.findByRole('button', { name: 'Turn Events off for Penny Quill' }))

    await waitFor(() => expect(patches()).toEqual([['/api/admin/users/u1', { features: ['work_queue'] }]]))
    await waitFor(() => expect(screen.queryByText('Penny Quill')).not.toBeInTheDocument())
  })

  it('turns a flag on for a person picked from the list', async () => {
    const u = userEvent.setup()
    render(<PreviewsClient allMembers={[]} />)
    const box = await screen.findByRole('combobox', { name: 'Turn Events on for a person' })
    await u.type(box, 'bea')
    await u.click(await screen.findByRole('option', { name: /Bea Example/ }))

    await waitFor(() => expect(patches()).toEqual([['/api/admin/users/u2', { features: ['events'] }]]))
    const chips = await screen.findByRole('button', { name: 'Turn Events off for Bea Example' })
    expect(within(chips.parentElement!).getByText('Bea Example')).toBeInTheDocument()
  })
})

describe('PreviewsClient sync from a course, program or event', () => {
  it('adds everyone with access to the chosen source to the segment', async () => {
    const u = userEvent.setup()
    render(<PreviewsClient allMembers={[]} />)
    await u.click(await screen.findByRole('button', { name: 'Manage' }))
    const select = await screen.findByLabelText(/Add everyone with access/)
    await u.click(select)
    await u.selectOptions(select, await screen.findByRole('option', { name: 'Course One' }))
    await u.click(screen.getByRole('button', { name: 'Sync' }))

    expect(await screen.findByText('Added 2 (1 already in the segment)')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/segments/seg1/sync')!
    expect(JSON.parse(call[1].body)).toEqual({ type: 'course', id: 'c1' })
  })
})
