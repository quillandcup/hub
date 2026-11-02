// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginForm from '@/app/login/LoginForm'

const LAST_EMAIL_KEY = 'hedgiehub:lastEmail'

const signInWithOtp = vi.fn()
const resendPendingInvite = vi.fn()
const verifyEmailCode = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOtp } }),
}))
vi.mock('@/app/login/actions', () => ({
  resendPendingInvite: (email: string) => resendPendingInvite(email),
  verifyEmailCode: (email: string, code: string) => verifyEmailCode(email, code),
}))

const signupDisabled = { error: { code: 'signup_disabled', message: 'Signups not allowed for this instance' } }

const { signInWithSlackCode } = vi.hoisted(() => ({ signInWithSlackCode: vi.fn() }))
vi.mock('@/app/auth/slack/actions', () => ({ signInWithSlackCode }))

const SLACK_HOME = 'slack://app?team=T1&id=A1&tab=home'

beforeEach(() => {
  window.localStorage.clear()
  signInWithOtp.mockReset().mockResolvedValue({ error: null })
  resendPendingInvite.mockReset()
  verifyEmailCode.mockReset()
  signInWithSlackCode.mockReset()
})

async function submit(email: string) {
  render(<LoginForm slackHomeUrl={null} />)
  await userEvent.type(screen.getByLabelText('Email address'), email)
  await userEvent.click(screen.getByRole('button', { name: 'Send Magic Link' }))
}

describe('LoginForm', () => {
  it('pre-fills the email input from a previously saved address', () => {
    window.localStorage.setItem(LAST_EMAIL_KEY, 'returning@example.com')

    render(<LoginForm slackHomeUrl={null} />)

    expect(screen.getByLabelText('Email address')).toHaveValue('returning@example.com')
  })

  it('leaves the email input blank when nothing was saved before', () => {
    render(<LoginForm slackHomeUrl={null} />)

    expect(screen.getByLabelText('Email address')).toHaveValue('')
  })

  it('saves the email to localStorage as the user types', async () => {
    render(<LoginForm slackHomeUrl={null} />)

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

  describe('asking twice within the minute', () => {
    const rateLimited = { error: { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 52 seconds.' } }

    afterEach(() => vi.useRealTimers())

    it('says a link was just sent, then clears itself', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      signInWithOtp.mockResolvedValue(rateLimited)
      render(<LoginForm slackHomeUrl={null} />)
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'member@example.com' } })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send Magic Link' }))
      })

      expect(screen.getByText(/We just emailed you a link/)).toBeInTheDocument()
      expect(screen.queryByText(/For security purposes/)).not.toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      expect(screen.queryByText(/We just emailed you a link/)).not.toBeInTheDocument()
    })
  })

  describe('signing in with the emailed code', () => {
    it('offers the code only after a link was sent', async () => {
      render(<LoginForm slackHomeUrl={null} />)
      expect(screen.queryByLabelText(/Enter the code from the email/)).not.toBeInTheDocument()

      await userEvent.type(screen.getByLabelText('Email address'), 'member@example.com')
      await userEvent.click(screen.getByRole('button', { name: 'Send Magic Link' }))

      expect(await screen.findByLabelText(/Enter the code from the email/)).toBeInTheDocument()
    })

    it('sends the typed email and code, and shows the error when it is refused', async () => {
      verifyEmailCode.mockResolvedValue({ error: "That code didn't work." })
      await submit('member@example.com')

      await userEvent.type(await screen.findByLabelText(/Enter the code from the email/), '12345678')
      await userEvent.click(screen.getByRole('button', { name: 'Sign in with code' }))

      expect(await screen.findByText("That code didn't work.")).toBeInTheDocument()
      expect(verifyEmailCode).toHaveBeenCalledWith('member@example.com', '12345678')
    })
  })

  it('explains a failed sign-in link and points at the code', () => {
    render(<LoginForm slackHomeUrl={null} callbackFailed />)

    expect(screen.getByText(/That sign-in link didn't work/)).toBeInTheDocument()
  })

  it("links to the Slack app's Home tab when configured", () => {
    render(<LoginForm slackHomeUrl={SLACK_HOME} />)

    expect(screen.getByRole('link', { name: 'Open Hedgie Hub in Slack' })).toHaveAttribute('href', SLACK_HOME)
  })

  it('shows no Slack sign-in at all until the Slack app is configured', () => {
    render(<LoginForm slackHomeUrl={null} />)

    expect(screen.queryByRole('link', { name: 'Open Hedgie Hub in Slack' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/paste the sign-in link or code from Slack/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Paste from Slack' })).not.toBeInTheDocument()
  })

  describe('pasting from Slack', () => {
    const TOKEN = 'x'.repeat(43)
    let assign: ReturnType<typeof vi.fn>

    beforeEach(() => {
      assign = vi.fn()
      Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } })
    })

    function codeInput() {
      return screen.getByLabelText(/paste the sign-in link or code/i)
    }

    it('submits a typed code as soon as it is complete, with no extra click', async () => {
      signInWithSlackCode.mockResolvedValue({ error: "That code didn't work." })
      render(<LoginForm slackHomeUrl={SLACK_HOME} />)

      await userEvent.type(codeInput(), 'abcde-12345')

      expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work.")
      expect(signInWithSlackCode).toHaveBeenCalledTimes(1)
      expect((signInWithSlackCode.mock.calls[0][1] as FormData).get('code')).toBe('ABCDE-12345')
    })

    it('submits a pasted code immediately', async () => {
      signInWithSlackCode.mockResolvedValue({ error: 'nope' })
      render(<LoginForm slackHomeUrl={SLACK_HOME} />)

      await userEvent.click(codeInput())
      await userEvent.paste('Or enter this code on the sign-in page: `ABCDE-12345`')

      await screen.findByRole('alert')
      expect((signInWithSlackCode.mock.calls[0][1] as FormData).get('code')).toBe('ABCDE-12345')
    })

    it('follows a pasted sign-in link on our own site, whatever host it was copied from', async () => {
      render(<LoginForm slackHomeUrl={SLACK_HOME} />)

      await userEvent.click(codeInput())
      await userEvent.paste(`https://evil.example/auth/slack?token=${TOKEN}`)

      expect(assign).toHaveBeenCalledWith(`/auth/slack?token=${TOKEN}`)
      expect(signInWithSlackCode).not.toHaveBeenCalled()
    })

    it('"Paste from Slack" reads the clipboard and signs in', async () => {
      render(<LoginForm slackHomeUrl={SLACK_HOME} />)
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: vi.fn().mockResolvedValue(`https://hub.quillandcup.com/auth/slack?token=${TOKEN}`) },
      })

      await userEvent.click(screen.getByRole('button', { name: 'Paste from Slack' }))

      expect(assign).toHaveBeenCalledWith(`/auth/slack?token=${TOKEN}`)
    })

    it('"Paste from Slack" explains an empty or unrelated clipboard', async () => {
      render(<LoginForm slackHomeUrl={SLACK_HOME} />)
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: vi.fn().mockResolvedValue('shopping list') },
      })

      await userEvent.click(screen.getByRole('button', { name: 'Paste from Slack' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/no Hedgie Hub link or code on your clipboard/)
      expect(assign).not.toHaveBeenCalled()
    })
  })
})
