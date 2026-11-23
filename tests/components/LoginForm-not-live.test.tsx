// @vitest-environment jsdom
// The login page while the public site is NOT live (config/app.ts `publicSiteLive` false): as it was before the root-host work.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginForm from '@/app/login/LoginForm'

vi.mock('@/lib/config', () => import('@/tests/helpers/public-site').then((m) => m.notLiveConfigModule()))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOtp: vi.fn() } }) }))
vi.mock('@/app/login/actions', () => ({ resendPendingInvite: vi.fn(), verifyEmailCode: vi.fn() }))
vi.mock('@/app/auth/slack/actions', () => ({ signInWithSlackCode: vi.fn() }))

describe('LoginForm before the cutover', () => {
  it('has no Kajabi sign-in note, and still the form', () => {
    render(<LoginForm slackHomeUrl={null} />)
    expect(screen.queryByTestId('kajabi-sign-in-note')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign in there' })).toBeNull()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send Magic Link' })).toBeInTheDocument()
  })
})
