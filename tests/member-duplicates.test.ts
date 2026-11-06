import { describe, it, expect } from 'vitest'
import { detectDuplicates, withDuplicateAliases } from '@/lib/member-duplicates'
import { InMemoryDataset } from '@/lib/data/in-memory'
import { createInMemoryRepos } from '@/lib/data/repos'

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
      expect(groups[0].confidence).toBe('medium')
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
      expect(groups[0].confidence).toBe('high')
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

  describe('fuzzy name detection', () => {
    it('flags a likely typo in the first name when the last name matches exactly', () => {
      const members = [
        member('1', 'John Smith', 'a@example.com'),
        member('2', 'Jon Smith', 'b@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
      expect(groups[0].confidence).toBe('low')
      expect(groups[0].reason).toMatch(/Similar name \(\d+% match\)/)
    })

    it('flags a nickname/short-form first name when the last name matches exactly', () => {
      const members = [
        member('1', 'Robert Smith', 'a@example.com'),
        member('2', 'Rob Smith', 'b@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
      expect(groups[0].confidence).toBe('low')
    })

    it('does not flag two different people who merely share a first name', () => {
      const members = [
        member('1', 'Alice Smith', 'a@example.com'),
        member('2', 'Alice Jones', 'b@example.com'),
      ]
      expect(detectDuplicates(members)).toHaveLength(0)
    })

    it('does not flag two different people who merely share a last name', () => {
      const members = [
        member('1', 'Sarah Johnson', 'a@example.com'),
        member('2', 'Mike Johnson', 'b@example.com'),
      ]
      expect(detectDuplicates(members)).toHaveLength(0)
    })

    it('does not re-flag a pair already caught by an exact match', () => {
      const members = [
        member('1', 'Alice Smith', 'alice@example.com'),
        member('2', 'Alice Smith', 'alice@example.com'),
      ]
      const groups = detectDuplicates(members)
      expect(groups).toHaveLength(1)
      expect(groups[0].reason).toBe('Same email')
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

describe('detectDuplicates with aliases', () => {
  it("flags two members when one's other email is the other's email, as a high-confidence match", () => {
    const groups = detectDuplicates([
      { ...member('1', 'Alice Smith', 'alice@new.example.com'), emailAliases: ['alice@old.example.com'] },
      member('2', 'A. Smythe', 'ALICE@old.example.com'),
      member('3', 'Carol Lee', 'carol@example.com'),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ reason: 'Email matches an alias', confidence: 'high' })
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(['1', '2'])
  })

  it('does not flag a member against themselves, or two members who only have different aliases', () => {
    const groups = detectDuplicates([
      { ...member('1', 'Alice Smith', 'alice@example.com'), emailAliases: ['alice@example.com', 'alice@old.example.com'], nameAliases: ['Alice Smith', 'Allie'], displayName: 'Allie' },
      { ...member('2', 'Bob Jones', 'bob@example.com'), emailAliases: ['bob@old.example.com'], nameAliases: ['Bobby'] },
    ])

    expect(groups).toEqual([])
  })

  it("flags a member whose name is another member's pen name or alias as a medium-confidence match", () => {
    const viaDisplayName = detectDuplicates([
      member('1', 'Penny Quill', 'penny@example.com'),
      { ...member('2', 'Ada Lovelace', 'ada@example.com'), displayName: 'penny  quill' },
    ])
    expect(viaDisplayName).toHaveLength(1)
    expect(viaDisplayName[0]).toMatchObject({ reason: 'Name matches a pen name or alias', confidence: 'medium' })

    const viaAlias = detectDuplicates([
      member('1', 'Ada L', 'ada1@example.com'),
      { ...member('2', 'Ada Lovelace', 'ada2@example.com'), nameAliases: ['Ada L'] },
    ])
    expect(viaAlias.map((g) => g.reason)).toEqual(['Name matches a pen name or alias'])
  })

  it('keeps a plain exact match worded as before, and reports a pair once even when several signals agree', () => {
    const both = detectDuplicates([
      { ...member('1', 'Alice Smith', 'alice@example.com'), emailAliases: ['shared@example.com'] },
      { ...member('2', 'Alice Smith', 'shared@example.com') },
    ])
    expect(both.map((g) => `${g.reason}|${g.confidence}`)).toEqual(['Email matches an alias|high'])

    expect(detectDuplicates([member('1', 'Alice Smith', 'a@example.com'), member('2', 'Alice Smith', 'b@example.com')]).map((g) => g.reason)).toEqual(['Same name'])
  })
})

describe('withDuplicateAliases', () => {
  it("adds each member's active email and name aliases, and leaves the inactive ones out", async () => {
    const repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: 'mbr_AAAAAAAAAAA1', name: 'Ada Example', email: 'ada@example.com' }, { id: 'mbr_AAAAAAAAAAA2', name: 'Grace Example', email: 'grace@example.com' }] }))
    await repos.aliases.addEmail('mbr_AAAAAAAAAAA1', 'ada.old@example.com', 'manual')
    await repos.aliases.addEmail('mbr_AAAAAAAAAAA1', 'ada.off@example.com', 'manual')
    const off = (await repos.aliases.emailsOf('mbr_AAAAAAAAAAA1')).find((a) => a.alias_email === 'ada.off@example.com')!
    await repos.aliases.setEmailActive('mbr_AAAAAAAAAAA1', off.id, false)
    await repos.aliases.addName('mbr_AAAAAAAAAAA1', 'Ada L', 'member')

    const result = await withDuplicateAliases(repos, [member('mbr_AAAAAAAAAAA1', 'Ada Example', 'ada@example.com'), member('mbr_AAAAAAAAAAA2', 'Grace Example', 'grace@example.com')])

    expect(result[0]).toMatchObject({ emailAliases: ['ada.old@example.com'], nameAliases: ['Ada L'] })
    expect(result[1]).toMatchObject({ emailAliases: [], nameAliases: [] })
  })
})
