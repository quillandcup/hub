// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginForm from '@/app/login/LoginForm'

const LAST_EMAIL_KEY = 'hedgiehub:lastEmail'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}))

beforeEach(() => {
  window.localStorage.clear()
})

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
})
