// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CalendarWeekView from '@/components/CalendarWeekView'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

const weekStartDate = { year: 2026, month: 5, day: 1 }

describe('CalendarWeekView timezone selector', () => {
  it('selects the profile timezone when it is a preset option', () => {
    render(
      <CalendarWeekView
        prickles={[]}
        weekStartDate={weekStartDate}
        userTimezonePreference="America/Chicago"
        mode="admin"
      />
    )
    const select = screen.getByLabelText('Timezone') as HTMLSelectElement
    expect(select.value).toBe('America/Chicago')
  })

  it('adds and selects the profile timezone when it is not one of the preset options', () => {
    render(
      <CalendarWeekView
        prickles={[]}
        weekStartDate={weekStartDate}
        userTimezonePreference="Europe/London"
        mode="admin"
      />
    )
    const select = screen.getByLabelText('Timezone') as HTMLSelectElement
    // Regression: previously the <select> value silently fell back to the
    // first preset option (Eastern) because "Europe/London" had no matching
    // <option>, even though the underlying calendar math used it correctly.
    expect(select.value).toBe('Europe/London')
    expect(screen.getByRole('option', { name: 'Europe/London' })).toBeInTheDocument()
  })
})
