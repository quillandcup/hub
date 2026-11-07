// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReauthModal from '@/app/(member)/settings/ReauthModal'
import * as identityActions from '@/app/(member)/settings/identityActions'

vi.mock('@/app/(member)/settings/identityActions', () => ({
  loadRecentSignIn: vi.fn(),
  sendReauthCode: vi.fn(),
  verifyReauthCode: vi.fn(),
}))

const onClose = vi.fn()
const onVerified = vi.fn()
const open = () => render(<ReauthModal isOpen onClose={onClose} onVerified={onVerified} />)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(identityActions.sendReauthCode).mockResolvedValue({ success: true, sentTo: 'ada@example.com' })
  vi.mocked(identityActions.verifyReauthCode).mockResolvedValue({ success: true })
  vi.mocked(identityActions.loadRecentSignIn).mockResolvedValue({ recent: false })
})

describe('ReauthModal', () => {
  it('sends one sign-in email when it opens and says where it went', async () => {
    open()

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
    expect(identityActions.sendReauthCode).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toHaveAccessibleName("Confirm it's you")
  })

  it('does nothing while closed', () => {
    render(<ReauthModal isOpen={false} onClose={onClose} onVerified={onVerified} />)
    expect(identityActions.sendReauthCode).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('finishes when the code is right, once', async () => {
    open()
    await screen.findByText('ada@example.com')
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Sign-in code'), '1234 5678')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(identityActions.verifyReauthCode).toHaveBeenCalledWith('1234 5678')
  })

  it('shows why a wrong code was refused and stays open', async () => {
    vi.mocked(identityActions.verifyReauthCode).mockResolvedValue({ error: "That code didn't work." })
    open()
    await screen.findByText('ada@example.com')
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Sign-in code'), '00000000')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work.")
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('shows a refusal to send, and sends a new code on request', async () => {
    vi.mocked(identityActions.sendReauthCode)
      .mockResolvedValueOnce({ error: 'We just sent one. Check your inbox (and spam), or try again in a minute.' })
      .mockResolvedValueOnce({ success: true, sentTo: 'ada@example.com' })
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('We just sent one')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Send a new code' }))

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
    expect(identityActions.sendReauthCode).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('carries on by itself when they come back after opening the link in the email', async () => {
    open()
    await screen.findByText('ada@example.com')

    fireEvent.focus(window)
    await waitFor(() => expect(identityActions.loadRecentSignIn).toHaveBeenCalled())
    expect(onVerified).not.toHaveBeenCalled()

    vi.mocked(identityActions.loadRecentSignIn).mockResolvedValue({ recent: true })
    fireEvent.focus(window)
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    fireEvent.focus(window)
    await waitFor(() => expect(identityActions.loadRecentSignIn).toHaveBeenCalledTimes(3))
    expect(onVerified).toHaveBeenCalledTimes(1)
  })

  it('closes from the close button', async () => {
    open()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
