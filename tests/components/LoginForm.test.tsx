// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginForm from '@/app/login/LoginForm'

const LAST_EMAIL_KEY = 'hedgiehub:lastEmail'

const signInWithOtp = vi.fn()
const resendPendingInvite = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOtp } }),
}))
vi.mock('@/app/login/actions', () => ({
  resendPendingInvite: (email: string) => resendPendingInvite(email),
}))

const signupDisabled = { error: { code: 'signup_disabled', message: 'Signups not allowed for this instance' } }

beforeEach(() => {
  window.localStorage.clear()
  signInWithOtp.mockReset().mockResolvedValue({ error: null })
  resendPendingInvite.mockReset()
})

async function submit(email: string) {
  render(<LoginForm />)
  await userEvent.type(screen.getByLabelText('Email address'), email)
  await userEvent.click(screen.getByRole('button', { name: 'Send Magic Link' }))
}

describe('LoginForm', () => {
  it('pre-fills the email input from a previously saved address', () => {
    window.localStorage.setItem(LAST_EMAIL_KEY, 'returning@example.com')

    render(<LoginForm />)

    expect(screen.getByLabelText('Email address')).toHaveValue('returning@example.com')
  })

  it('leaves the email input blank when nothing was saved before', () => {
    render(<LoginForm />)

    expect(screen.getByLabelText('Email address')).toHaveValue('')
  })

  it('saves the email to localStorage as the user types', async () => {
    render(<LoginForm />)

    await userEvent.type(screen.getByLabelText('Email address'), 'new@example.com')

    expect(window.localStorage.getItem(LAST_EMAIL_KEY)).toBe('new@example.com')
  })

  it('sends a magic link without checking invites when sign-in works', async () => {
    await submit('member@example.com')

    expect(await screen.findByText('Check your email for the magic link!')).toBeInTheDocument()
    expect(resendPendingInvite).not.toHaveBeenCalled()
  })

  it('re-sends the invite for an invited user who never accepted', async () => {
    signInWithOtp.mockResolvedValue(signupDisabled)
    resendPendingInvite.mockResolvedValue({ invited: true })

    await submit('invitee@example.com')

    expect(await screen.findByText(/emailed you a fresh invitation/)).toBeInTheDocument()
    expect(resendPendingInvite).toHaveBeenCalledWith('invitee@example.com')
    expect(screen.queryByText(/Signups not allowed/)).not.toBeInTheDocument()
  })

  it('explains, instead of "Signups not allowed", when the email has no account or invite', async () => {
    signInWithOtp.mockResolvedValue(signupDisabled)
    resendPendingInvite.mockResolvedValue({ invited: false })

    await submit('stranger@example.com')

    expect(await screen.findByText(/couldn't find a Hedgie Hub account/)).toBeInTheDocument()
    expect(screen.queryByText(/Signups not allowed/)).not.toBeInTheDocument()
  })
})
