// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimezoneProvider, useTimeZone } from '@/components/Timezone'
import { ORG_TIMEZONE } from '@/lib/config'

function Zone() {
  return <span>{useTimeZone()}</span>
}

describe('TimezoneProvider', () => {
  it('gives the viewer\'s zone to client components below it', () => {
    render(<TimezoneProvider zone="Asia/Tokyo"><Zone /></TimezoneProvider>)
    expect(screen.getByText('Asia/Tokyo')).toBeTruthy()
  })

  it('defaults to the org zone outside a provider', () => {
    render(<Zone />)
    expect(screen.getByText(ORG_TIMEZONE)).toBeTruthy()
  })
})
