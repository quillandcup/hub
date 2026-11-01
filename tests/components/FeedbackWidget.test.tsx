// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HelpMenu from '@/components/HelpMenu'

vi.mock('html-to-image', () => ({
  toBlob: vi.fn().mockResolvedValue(new Blob(['fake-png'], { type: 'image/png' })),
}))

import { toBlob } from 'html-to-image'

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ id: 'f1', screenshotCaptured: true }) }) as any
})

async function openFeedback() {
  await userEvent.click(screen.getByRole('button', { name: 'Help' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Send feedback' }))
}

describe('Send feedback (from the Help menu)', () => {
  it('has no floating launcher and keeps the form closed until chosen from the menu', () => {
    render(<HelpMenu />)
    expect(screen.queryByLabelText('Send feedback')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Send feedback' })).not.toBeInTheDocument()
  })

  it('opens the popover and captures a screenshot on click', async () => {
    render(<HelpMenu />)
    await openFeedback()

    expect(screen.getByPlaceholderText("What's going on?")).toBeInTheDocument()
    await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Screenshot captured')
    )
  })

  it('submits feedback and stays open for another entry', async () => {
    render(<HelpMenu />)
    await openFeedback()
    await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByPlaceholderText("What's going on?"), 'The chart is wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/feedback',
        expect.objectContaining({ method: 'POST' })
      )
    )
    await waitFor(() => expect(screen.getByText('✓ Sent — thank you!')).toBeInTheDocument())

    // Popover stays open (no re-click needed) and the textarea clears, ready
    // for the next piece of feedback on the same page.
    expect(screen.getByPlaceholderText("What's going on?")).toHaveValue('')

    const [, options] = vi.mocked(global.fetch).mock.calls[0]
    const body = options!.body as FormData
    expect(body.get('feedback_type')).toBe('bug')
    expect(body.get('message')).toBe('The chart is wrong')
    expect(body.get('screenshot')).toBeInstanceOf(Blob)
  })

  it('falls back gracefully when screenshot capture fails', async () => {
    vi.mocked(toBlob).mockRejectedValueOnce(new Error('capture failed'))
    render(<HelpMenu />)
    await openFeedback()

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't capture a screenshot")
    )

    await userEvent.type(screen.getByPlaceholderText("What's going on?"), 'Still works')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText('✓ Sent — thank you!')).toBeInTheDocument())
    const [, options] = vi.mocked(global.fetch).mock.calls[0]
    const body = options!.body as FormData
    expect(body.get('screenshot')).toBeNull()
  })
})
