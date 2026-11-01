import { describe, it, expect } from 'vitest'
import { resolveTimeZone } from '@/lib/timezone'
import { ORG_TIMEZONE } from '@/lib/config'

describe('resolveTimeZone', () => {
  it('uses a stored zone', () => {
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo')
  })

  it('falls back to the org zone before the first page load saves one', () => {
    expect(resolveTimeZone('browser')).toBe(ORG_TIMEZONE)
    expect(resolveTimeZone(null)).toBe(ORG_TIMEZONE)
    expect(resolveTimeZone(undefined)).toBe(ORG_TIMEZONE)
  })

  it('falls back to the org zone for something that is not a zone', () => {
    expect(resolveTimeZone('Not/AZone')).toBe(ORG_TIMEZONE)
  })
})
