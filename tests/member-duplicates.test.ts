import { describe, it, expect } from 'vitest'
import { detectDuplicates } from '@/lib/member-duplicates'

function member(id: string, name: string, email: string, status = 'active') {
  return { id, name, email, status }
}

describe('detectDuplicates', () => {
  it('returns empty array when no members', () => {
    expect(detectDuplicates([])).toEqual([])
  })

  it('returns empty array when all members are unique', () => {
    const members = [
      member('1', 'Alice Smith', 'alice@example.com'),
      member('2', 'Bob Jones', 'bob@example.com'),
      member('3', 'Carol Lee', 'carol@example.com'),
    ]
    expect(detectDuplicates(members)).toEqual([])
  })

  describe('name-based detection', () => {
    it('detects two members with identical names', () => {
      const members = [
        member('1', 'Alice Smith', 'alice@example.com'),
        member('2', 'Alice Smith', 'alice2@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
      expect(groups[0].reason).toBe('Same name')
      expect(groups[0].members.map(m => m.id)).toEqual(expect.arrayContaining(['1', '2']))
    })

    it('detects three members with the same name as one group', () => {
      const members = [
        member('1', 'Alice Smith', 'a1@example.com'),
        member('2', 'Alice Smith', 'a2@example.com'),
        member('3', 'Alice Smith', 'a3@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
      expect(groups[0].members).toHaveLength(3)
    })

    it('is case-insensitive for name matching', () => {
      const members = [
        member('1', 'alice smith', 'a1@example.com'),
        member('2', 'ALICE SMITH', 'a2@example.com'),
        member('3', 'Alice Smith', 'a3@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
      expect(groups[0].members).toHaveLength(3)
    })

    it('collapses extra whitespace when comparing names', () => {
      const members = [
        member('1', 'Alice  Smith', 'a1@example.com'),
        member('2', 'Alice Smith', 'a2@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
    })

    it('trims leading/trailing whitespace from names', () => {
      const members = [
        member('1', '  Alice Smith  ', 'a1@example.com'),
        member('2', 'Alice Smith', 'a2@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
    })

    it('does not group members with different names', () => {
      const members = [
        member('1', 'Alice Smith', 'a@example.com'),
        member('2', 'Alice Jones', 'b@example.com'),
      ]
      expect(detectDuplicates(members)).toHaveLength(0)
    })
  })

  describe('email-based detection', () => {
    it('detects two members with identical emails', () => {
      const members = [
        member('1', 'Alice Smith', 'alice@example.com'),
        member('2', 'Alice S.', 'alice@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
      expect(groups[0].reason).toBe('Same email')
      expect(groups[0].members.map(m => m.id)).toEqual(expect.arrayContaining(['1', '2']))
    })

    it('is case-insensitive for email matching', () => {
      const members = [
        member('1', 'Alice Smith', 'Alice@Example.COM'),
        member('2', 'Alice S.', 'alice@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
    })

    it('does not group members with different emails', () => {
      const members = [
        member('1', 'Alice Smith', 'alice@example.com'),
        member('2', 'Bob Jones', 'bob@example.com'),
      ]
      expect(detectDuplicates(members)).toHaveLength(0)
    })
  })

  describe('deduplication across name and email matches', () => {
    it('does not double-count a pair matched by both name and email', () => {
      const members = [
        member('1', 'Alice Smith', 'alice@example.com'),
        member('2', 'Alice Smith', 'alice@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
    })

    it('reports two separate groups when different pairs match on different criteria', () => {
      const members = [
        member('1', 'Alice Smith', 'alice@example.com'),
        member('2', 'Alice Smith', 'alice2@example.com'),  // same name, different email
        member('3', 'Carol Lee', 'shared@example.com'),
        member('4', 'Carol Ng', 'shared@example.com'),    // same email, different name
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(2)
      expect(groups.map(g => g.reason)).toEqual(expect.arrayContaining(['Same name', 'Same email']))
    })
  })

  describe('preserves member data', () => {
    it('includes all member fields in returned groups', () => {
      const members = [
        member('1', 'Alice Smith', 'alice@example.com', 'active'),
        member('2', 'Alice Smith', 'alice2@example.com', 'on_hiatus'),
      ]
      const groups = detectDuplicates(members)
      expect(groups[0].members[0]).toMatchObject({ id: '1', name: 'Alice Smith', status: 'active' })
      expect(groups[0].members[1]).toMatchObject({ id: '2', name: 'Alice Smith', status: 'on_hiatus' })
    })
  })
})
