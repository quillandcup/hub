// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TrackbearImportModal from '@/components/writing/TrackbearImportModal'
import type { TrackbearImportResult } from '@/lib/trackbear-import-runner'

const RESULT: TrackbearImportResult = {
  created: { projects: 2, entries: 1, goals: 1, startingBalances: 0, covers: 1 },
  alreadyImported: { projects: 0, entries: 3, goals: 0 },
  issues: [
    { severity: 'skipped', kind: 'goal', label: 'Yearly words', detail: 'Counts progress across all projects.' },
    { severity: 'dropped', kind: 'project', label: 'Poems', detail: 'Starred flag.' },
  ],
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function uploadAndSubmit() {
  const user = userEvent.setup()
  const file = new File(['PK'], 'trackbear-progress-export.zip', { type: 'application/zip' })
  await user.upload(screen.getByLabelText('TrackBear export file'), file)
  await user.click(screen.getByRole('button', { name: 'Import' }))
  return user
}

describe('TrackbearImportModal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads the file and shows what was imported and what could not be', async () => {
    const fetchMock = stubFetch(200, RESULT)
    const onImported = vi.fn()
    render(<TrackbearImportModal isOpen onClose={() => {}} onImported={onImported} />)

    const user = await uploadAndSubmit()

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/import/trackbear', expect.objectContaining({ method: 'POST' }))
    expect((fetchMock.mock.calls[0][1].body as FormData).get('file')).toBeInstanceOf(File)
    expect(await screen.findByText('2 projects')).toBeInTheDocument()
    expect(screen.getByText('1 progress entry')).toBeInTheDocument()
    expect(screen.getByText(/3 progress entries/)).toBeInTheDocument()
    expect(screen.getByText('Not imported')).toBeInTheDocument()
    expect(screen.getByText('Yearly words:')).toBeInTheDocument()
    expect(screen.getByText(/some details couldn't come along/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('shows the server error and does not refresh', async () => {
    stubFetch(400, { error: "That .zip doesn't contain trackbear-progress-data.json" })
    const onImported = vi.fn()
    render(<TrackbearImportModal isOpen onClose={() => {}} onImported={onImported} />)

    await uploadAndSubmit()

    expect(await screen.findByText(/doesn't contain trackbear-progress-data.json/)).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })
})
