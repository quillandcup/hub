// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimezoneProvider } from '@/components/Timezone'
import ProcessOrphanedButton from '@/app/(admin)/admin/hygiene/ProcessOrphanedButton'
import ProcessOrphanedMeetingsButton from '@/app/(admin)/admin/hygiene/ProcessOrphanedMeetingsButton'

// 03:00 UTC on Mar 1 is still Feb 29 in Eastern and already Mar 1 in Tokyo.
const dateRange = { fromDate: '2024-03-01T03:00:00Z', toDate: '2024-03-05T03:00:00Z' }

afterEach(() => vi.unstubAllGlobals())

describe.each([
  ['ProcessOrphanedButton', ProcessOrphanedButton, 'Process Orphaned Events'],
  ['ProcessOrphanedMeetingsButton', ProcessOrphanedMeetingsButton, 'Process Orphaned Meetings'],
])('%s', (_name, Component, label) => {
  it('asks about the date range in the viewer\'s zone', async () => {
    const confirmSpy = vi.fn((_message: string) => false)
    vi.stubGlobal('confirm', confirmSpy)
    render(
      <TimezoneProvider zone="Asia/Tokyo">
        <Component orphanedCount={3} dateRange={dateRange} />
      </TimezoneProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toContain('from 3/1/2024 to 3/5/2024')
  })

  it('uses the org zone without a provider', async () => {
    const confirmSpy = vi.fn((_message: string) => false)
    vi.stubGlobal('confirm', confirmSpy)
    render(<Component orphanedCount={3} dateRange={dateRange} />)
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(confirmSpy.mock.calls[0][0]).toContain('from 2/29/2024 to 3/4/2024')
  })

  it('refuses without a date range', async () => {
    render(<Component orphanedCount={3} dateRange={null} />)
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getByText(/Cannot determine date range/)).toBeTruthy()
  })
})
