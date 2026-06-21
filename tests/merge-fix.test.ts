import { describe, it, expect } from 'vitest'
import { sortGroupMembers } from '@/lib/merge-fix'
import type { EnrichedMember } from '@/lib/merge-fix'

function member(
  id: string,
  overrides: Partial<EnrichedMember> = {}
): EnrichedMember {
  return {
    id,
    name: `Member ${id}`,
    email: `m${id}@example.com`,
    status: 'inactive',
    stripe_customer_id: null,
    stripe_active: false,
    ...overrides,
  }
}

describe('sortGroupMembers', () => {
  it('returns a new array, does not mutate input', () => {
    const members = [member('1'), member('2')]
    const result = sortGroupMembers(members)
    expect(result).not.toBe(members)
  })

  it('preserves order when all members are equal', () => {
    const members = [member('1'), member('2'), member('3')]
    const result = sortGroupMembers(members)
    expect(result.map(m => m.id)).toEqual(['1', '2', '3'])
  })

  describe('active Kajabi status (highest priority)', () => {
    it('puts active Kajabi member first', () => {
      const members = [
        member('inactive', { status: 'inactive' }),
        member('active', { status: 'active' }),
      ]
      const result = sortGroupMembers(members)
      expect(result[0].id).toBe('active')
    })

    it('active Kajabi beats active Stripe subscription', () => {
      const members = [
        member('stripe-active', { stripe_customer_id: 'cus_1', stripe_active: true }),
        member('kajabi-active', { status: 'active' }),
      ]
      const result = sortGroupMembers(members)
      expect(result[0].id).toBe('kajabi-active')
    })

    it('active Kajabi beats having a Stripe record', () => {
      const members = [
        member('has-stripe', { stripe_customer_id: 'cus_1' }),
        member('kajabi-active', { status: 'active' }),
      ]
      const result = sortGroupMembers(members)
      expect(result[0].id).toBe('kajabi-active')
    })

    it('two active Kajabi members preserve relative order', () => {
      const members = [
        member('a', { status: 'active' }),
        member('b', { status: 'active' }),
      ]
      const result = sortGroupMembers(members)
      expect(result.map(m => m.id)).toEqual(['a', 'b'])
    })
  })

  describe('active Stripe subscription (second priority)', () => {
    it('puts active Stripe subscription ahead of inactive member', () => {
      const members = [
        member('no-stripe', { status: 'inactive' }),
        member('stripe-active', { stripe_customer_id: 'cus_1', stripe_active: true }),
      ]
      const result = sortGroupMembers(members)
      expect(result[0].id).toBe('stripe-active')
    })

    it('active Stripe beats just having a Stripe record', () => {
      const members = [
        member('has-stripe', { stripe_customer_id: 'cus_1', stripe_active: false }),
        member('stripe-active', { stripe_customer_id: 'cus_2', stripe_active: true }),
      ]
      const result = sortGroupMembers(members)
      expect(result[0].id).toBe('stripe-active')
    })
  })

  describe('has Stripe record (third priority)', () => {
    it('puts member with Stripe record ahead of member without', () => {
      const members = [
        member('no-stripe', {}),
        member('has-stripe', { stripe_customer_id: 'cus_1' }),
      ]
      const result = sortGroupMembers(members)
      expect(result[0].id).toBe('has-stripe')
    })
  })

  describe('full priority ordering', () => {
    it('ranks: active-kajabi > active-stripe > has-stripe > inactive-no-stripe', () => {
      const members = [
        member('d', {}),
        member('b', { stripe_customer_id: 'cus_2', stripe_active: true }),
        member('c', { stripe_customer_id: 'cus_3' }),
        member('a', { status: 'active' }),
      ]
      const result = sortGroupMembers(members)
      expect(result.map(m => m.id)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('active Kajabi with Stripe still ranks first', () => {
      const members = [
        member('stripe-only', { stripe_customer_id: 'cus_1', stripe_active: true }),
        member('kajabi-and-stripe', {
          status: 'active',
          stripe_customer_id: 'cus_2',
          stripe_active: true,
        }),
      ]
      const result = sortGroupMembers(members)
      expect(result[0].id).toBe('kajabi-and-stripe')
    })
  })
})
