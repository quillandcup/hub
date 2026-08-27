// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedbackWidget from '@/components/FeedbackWidget'

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

describe('FeedbackWidget', () => {
  it('renders a launcher button with the popover closed', () => {
    render(<FeedbackWidget />)
    expect(screen.getByLabelText('Send feedback')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Send feedback' })).not.toBeInTheDocument()
  })

  it('opens the popover and captures a screenshot on click', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByLabelText('Send feedback'))

    expect(screen.getByPlaceholderText("What's going on?")).toBeInTheDocument()
    await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Screenshot captured')
    )
  })

  it('submits feedback and stays open for another entry', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByLabelText('Send feedback'))
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
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByLabelText('Send feedback'))

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
