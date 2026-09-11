import { describe, it, expect } from 'vitest'
import { groupByCanonical } from '@/lib/external-conflicts'

interface TestItem {
  id: string
  email: string | null
  name: string | null
}

describe('groupByCanonical', () => {
  it('groups items sharing a canonical email and drops singletons', () => {
    const items: TestItem[] = [
      { id: 'a', email: 'person@example.com', name: 'Person' },
      { id: 'b', email: 'PERSON@example.com', name: 'Person' },
      { id: 'c', email: 'someone-else@example.com', name: 'Someone Else' },
    ]
    const groups = groupByCanonical(items, new Map(), (i) => i.id, (i) => i.name)

    expect(groups).toHaveLength(1)
    expect(groups[0].canonicalEmail).toBe('person@example.com')
    expect(groups[0].entries.map((e) => e.externalId)).toEqual(['a', 'b'])
  })

  it('resolves canonical email via the alias map before grouping', () => {
    const items: TestItem[] = [
      { id: 'a', email: 'old-alias@example.com', name: 'Person' },
      { id: 'b', email: 'canonical@example.com', name: 'Person' },
    ]
    const aliasMap = new Map([['old-alias@example.com', 'canonical@example.com']])
    const groups = groupByCanonical(items, aliasMap, (i) => i.id, (i) => i.name)

    expect(groups).toHaveLength(1)
    expect(groups[0].canonicalEmail).toBe('canonical@example.com')
  })

  // Regression: bronze.slack_users.email (and, rarely, Kajabi contacts/Stripe
  // customers) can be null at the DB level — /admin/hygiene and
  // /admin/hygiene/external-conflicts both crashed with
  // "Cannot read properties of null (reading 'toLowerCase')" once a null-email
  // row appeared in the data.
  it('skips items with a null email instead of throwing', () => {
    const items: TestItem[] = [
      { id: 'a', email: null, name: 'No Email' },
      { id: 'b', email: 'person@example.com', name: 'Person' },
      { id: 'c', email: 'person@example.com', name: 'Person' },
    ]

    expect(() =>
      groupByCanonical(items, new Map(), (i) => i.id, (i) => i.name)
    ).not.toThrow()

    const groups = groupByCanonical(items, new Map(), (i) => i.id, (i) => i.name)
    expect(groups).toHaveLength(1)
    expect(groups[0].entries.map((e) => e.externalId)).toEqual(['b', 'c'])
  })
})
