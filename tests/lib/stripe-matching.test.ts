import { describe, it, expect } from 'vitest'
import {
  buildReverseAliasMap,
  getMemberEmails,
  matchStripeCustomerToMember,
} from '@/lib/stripe-matching'

const members = [
  { id: 'm1', email: 'alice@example.com', kajabi_id: 'kjb_alice' },
  { id: 'm2', email: 'bob@example.com', kajabi_id: 'kjb_bob' },
  { id: 'm3', email: 'carol@example.com', kajabi_id: null },
]

const aliases = [
  { alias_email: 'alice-old@example.com', canonical_email: 'alice@example.com' },
  { alias_email: 'alice-work@example.com', canonical_email: 'alice@example.com' },
]

describe('buildReverseAliasMap', () => {
  it('maps canonical email to set of alias emails', () => {
    const map = buildReverseAliasMap(aliases)
    expect(map.get('alice@example.com')).toEqual(
      new Set(['alice-old@example.com', 'alice-work@example.com'])
    )
  })

  it('returns empty map for no aliases', () => {
    expect(buildReverseAliasMap([]).size).toBe(0)
  })

  it('is case-insensitive', () => {
    const map = buildReverseAliasMap([
      { alias_email: 'ALIAS@Example.COM', canonical_email: 'Canonical@Example.COM' },
    ])
    expect(map.get('canonical@example.com')?.has('alias@example.com')).toBe(true)
  })
})

describe('getMemberEmails', () => {
  const reverseAliasMap = buildReverseAliasMap(aliases)

  it('includes the canonical email', () => {
    const emails = getMemberEmails(members[0], reverseAliasMap)
    expect(emails.has('alice@example.com')).toBe(true)
  })

  it('includes alias emails', () => {
    const emails = getMemberEmails(members[0], reverseAliasMap)
    expect(emails.has('alice-old@example.com')).toBe(true)
    expect(emails.has('alice-work@example.com')).toBe(true)
  })

  it('returns only canonical email when no aliases', () => {
    const emails = getMemberEmails(members[1], reverseAliasMap)
    expect(emails).toEqual(new Set(['bob@example.com']))
  })
})

describe('matchStripeCustomerToMember', () => {
  const reverseAliasMap = buildReverseAliasMap(aliases)

  it('matches by kajabi_id metadata', () => {
    const customer = { email: 'unknown@example.com', data: { metadata: { kjb_member_id: 'kjb_alice' } } }
    const match = matchStripeCustomerToMember(customer, members, reverseAliasMap)
    expect(match?.id).toBe('m1')
  })

  it('matches by canonical email', () => {
    const customer = { email: 'bob@example.com', data: {} }
    const match = matchStripeCustomerToMember(customer, members, reverseAliasMap)
    expect(match?.id).toBe('m2')
  })

  it('matches by alias email', () => {
    const customer = { email: 'alice-old@example.com', data: {} }
    const match = matchStripeCustomerToMember(customer, members, reverseAliasMap)
    expect(match?.id).toBe('m1')
  })

  it('returns null when no email and no kajabi_id match', () => {
    const customer = { email: 'stranger@example.com', data: {} }
    const match = matchStripeCustomerToMember(customer, members, reverseAliasMap)
    expect(match).toBeNull()
  })

  it('returns null when customer has no email and no metadata', () => {
    const customer = { email: null, data: {} }
    const match = matchStripeCustomerToMember(customer, members, reverseAliasMap)
    expect(match).toBeNull()
  })

  it('prefers kajabi_id over email when both would match different members', () => {
    const membersWithConflict = [
      { id: 'byKajabi', email: 'other@example.com', kajabi_id: 'kjb_target' },
      { id: 'byEmail', email: 'customer@example.com', kajabi_id: null },
    ]
    const customer = {
      email: 'customer@example.com',
      data: { metadata: { kjb_member_id: 'kjb_target' } },
    }
    const match = matchStripeCustomerToMember(customer, membersWithConflict, new Map())
    expect(match?.id).toBe('byKajabi')
  })
})
