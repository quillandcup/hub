// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedbackClient from '@/app/(admin)/admin/feedback/FeedbackClient'

const ITEM = {
  id: 'f1',
  created_at: '2026-01-01T00:00:00Z',
  user_id: 'u1',
  is_sudo: false,
  page_url: '/admin/members',
  feedback_type: 'bug' as const,
  message: 'Something is broken',
  status: 'new' as const,
  admin_notes: null,
  submitter_email: 'member@example.com',
  screenshot_url: 'https://example.com/screenshot.png',
  member: null,
}

beforeEach(() => {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ items: [ITEM], total: 1 }) }) as any
})

async function renderWithLightboxOpen() {
  render(<FeedbackClient />)
  await waitFor(() => expect(screen.getByAltText('Feedback screenshot')).toBeInTheDocument())
  // Two images with this alt text once the lightbox is open: the thumbnail and the lightbox image.
  await userEvent.click(screen.getAllByAltText('Feedback screenshot')[0])
  await waitFor(() => expect(screen.getAllByAltText('Feedback screenshot')).toHaveLength(2))
}

describe('FeedbackClient screenshot lightbox', () => {
  it('closes the lightbox when Escape is pressed', async () => {
    await renderWithLightboxOpen()

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.getAllByAltText('Feedback screenshot')).toHaveLength(1))
  })

  it('closes the lightbox when clicking the backdrop', async () => {
    await renderWithLightboxOpen()

    const images = screen.getAllByAltText('Feedback screenshot')
    const lightboxImage = images[1]
    // Click the backdrop (the image's parent), not the image itself.
    await userEvent.click(lightboxImage.parentElement as HTMLElement)

    await waitFor(() => expect(screen.getAllByAltText('Feedback screenshot')).toHaveLength(1))
  })

  it('does not close when other keys are pressed', async () => {
    await renderWithLightboxOpen()

    await userEvent.keyboard('{Enter}')

    expect(screen.getAllByAltText('Feedback screenshot')).toHaveLength(2)
  })
})
