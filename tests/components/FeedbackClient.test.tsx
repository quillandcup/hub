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
  member_id: 'm1',
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

describe('FeedbackClient submitter', () => {
  it('names the submitter by display name', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ ...ITEM, member: { name: 'Ada Example', display_name: 'Ada E', email: 'ada@example.com' } }], total: 1 }),
    }) as any
    render(<FeedbackClient />)
    expect(await screen.findByText('Ada E')).toBeInTheDocument()
    expect(screen.queryByText('Ada Example')).toBeNull()
  })
})

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

describe('FeedbackClient sudo-as-reporter', () => {
  it('shows a one-click sudo button when the item has a member', async () => {
    render(<FeedbackClient />)

    const button = await screen.findByRole('button', { name: 'Sudo as reporter' })
    expect(button.closest('form')).not.toBeNull()
  })

  it('hides the sudo button when the feedback has no linked member', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ ...ITEM, member_id: null }], total: 1 }),
    }) as any

    render(<FeedbackClient />)

    await waitFor(() => expect(screen.getByText(ITEM.message)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Sudo as reporter' })).not.toBeInTheDocument()
  })
})

describe('FeedbackClient for one member', () => {
  it('asks for that member only, and says so with a way back', async () => {
    render(<FeedbackClient memberId="mbr_AAAAAAAAAAA1" />)
    await waitFor(() => expect(screen.getByText('Something is broken')).toBeInTheDocument())
    expect(String((global.fetch as any).mock.calls[0][0])).toContain('member=mbr_AAAAAAAAAAA1')
    expect(screen.getByText(/Showing one member's feedback/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Show everyone's" })).toHaveAttribute('href', '/admin/feedback')
    expect(screen.getByRole('link', { name: 'open the member' })).toHaveAttribute('href', '/admin/members/mbr_AAAAAAAAAAA1')
  })

  it('asks for everyone, with no note, otherwise', async () => {
    render(<FeedbackClient />)
    await waitFor(() => expect(screen.getByText('Something is broken')).toBeInTheDocument())
    expect(String((global.fetch as any).mock.calls[0][0])).not.toContain('member=')
    expect(screen.queryByText(/Showing one member's feedback/)).toBeNull()
  })
})
