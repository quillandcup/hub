import { describe, it, expect } from 'vitest'
import { isMembershipOffer } from '@/lib/membership'

describe('isMembershipOffer', () => {
  it('matches exact membership product names', () => {
    expect(isMembershipOffer('Quill & Cup Membership')).toBe(true)
    expect(isMembershipOffer('Yes, girl! I see you!')).toBe(true)
  })

  it('matches offers containing "Membership"', () => {
    expect(isMembershipOffer('Quill & Cup Membership (Annual)')).toBe(true)
    expect(isMembershipOffer('Legacy Membership')).toBe(true)
  })

  it('excludes workshop and training offers', () => {
    expect(isMembershipOffer('Mindset Training for Live Feedback Workshop')).toBe(false)
    expect(isMembershipOffer('Quill & Cup Retreat Deposit for Estes Park, CO, USA Sept 12-15, 2024!')).toBe(false)
  })

  it('excludes empty string', () => {
    expect(isMembershipOffer('')).toBe(false)
  })
})
