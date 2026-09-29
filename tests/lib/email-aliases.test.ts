import { describe, it, expect } from 'vitest'
import {
  buildAliasMap,
  resolveEmail,
  buildMembersRunAliasMap,
  partitionEmailConflicts,
} from '@/lib/email-aliases'

describe('buildAliasMap / resolveEmail', () => {
  it('maps alias to canonical, case-insensitively', () => {
    const map = buildAliasMap([{ alias_email: 'Old@Example.com', canonical_email: 'New@Example.com' }])
    expect(resolveEmail('OLD@example.com', map)).toBe('new@example.com')
  })

  it('passes unknown emails through, lowercased', () => {
    expect(resolveEmail('Someone@Example.com', new Map())).toBe('someone@example.com')
  })
})

describe('buildMembersRunAliasMap', () => {
  const amanda = { id: 'm-amanda', email: 'amanda@aol.test', kajabi_id: 'k-primary' }

  it('resolves an alias to the member\'s current Kajabi email, not last run\'s members.email (regression)', () => {
    // Production failure: the member changed her Kajabi email; an alias for her
    // second Kajabi contact still resolved to her old address, so that contact
    // alone claimed the old address and the update hit members_email_key.
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [{ alias_email: 'books@gmail.test', member_id: amanda.id }],
      members: [amanda],
      contacts: [
        { kajabi_contact_id: 'k-primary', email: 'amanda518@gmail.test' },
        { kajabi_contact_id: 'k-books', email: 'books@gmail.test' },
      ],
    })
    expect(resolveEmail('books@gmail.test', aliasMap)).toBe('amanda518@gmail.test')
    expect(resolveEmail('amanda@aol.test', aliasMap)).toBe('amanda518@gmail.test')
    expect(resolveEmail('amanda518@gmail.test', aliasMap)).toBe('amanda518@gmail.test')
  })

  it('resolves to members.email when the member has no Kajabi contact (e.g. staff)', () => {
    const { aliasMap, runEmailByMemberId } = buildMembersRunAliasMap({
      aliases: [{ alias_email: 'old-staff@test', member_id: 'm-staff' }],
      members: [{ id: 'm-staff', email: 'Staff@Test', kajabi_id: null }],
      contacts: [],
    })
    expect(resolveEmail('old-staff@test', aliasMap)).toBe('staff@test')
    expect(runEmailByMemberId.get('m-staff')).toBe('staff@test')
  })

  it('resolves to members.email when the member\'s kajabi contact is gone from Bronze', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [{ alias_email: 'alias@test', member_id: 'm1' }],
      members: [{ id: 'm1', email: 'kept@test', kajabi_id: 'k-deleted' }],
      contacts: [],
    })
    expect(resolveEmail('alias@test', aliasMap)).toBe('kept@test')
  })

  it('maps a member\'s previous email to the new one when their Kajabi email changed', () => {
    const { aliasMap, runEmailByMemberId } = buildMembersRunAliasMap({
      aliases: [],
      members: [amanda],
      contacts: [{ kajabi_contact_id: 'k-primary', email: 'Amanda518@Gmail.test' }],
    })
    expect(runEmailByMemberId.get(amanda.id)).toBe('amanda518@gmail.test')
    expect(aliasMap.get('amanda@aol.test')).toBe('amanda518@gmail.test')
  })

  it('adds no implicit mapping when the email did not change', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [],
      members: [amanda],
      contacts: [{ kajabi_contact_id: 'k-primary', email: 'AMANDA@aol.test' }],
    })
    expect(aliasMap.size).toBe(0)
  })

  it('skips the implicit mapping when another Kajabi contact now uses the previous email', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [],
      members: [amanda],
      contacts: [
        { kajabi_contact_id: 'k-primary', email: 'amanda518@gmail.test' },
        { kajabi_contact_id: 'k-someone-else', email: 'amanda@aol.test' },
      ],
    })
    expect(aliasMap.has('amanda@aol.test')).toBe(false)
  })

  it('lets an explicit alias override the implicit previous-email mapping', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [{ alias_email: 'amanda@aol.test', member_id: 'm-other' }],
      members: [amanda, { id: 'm-other', email: 'other@test', kajabi_id: null }],
      contacts: [{ kajabi_contact_id: 'k-primary', email: 'amanda518@gmail.test' }],
    })
    expect(aliasMap.get('amanda@aol.test')).toBe('other@test')
  })

  it('drops a self-alias (member changed back to an address that had become their alias)', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [{ alias_email: 'amanda@aol.test', member_id: amanda.id }],
      members: [{ ...amanda, email: 'amanda518@gmail.test' }],
      contacts: [{ kajabi_contact_id: 'k-primary', email: 'amanda@aol.test' }],
    })
    expect(aliasMap.has('amanda@aol.test')).toBe(false)
    expect(aliasMap.get('amanda518@gmail.test')).toBe('amanda@aol.test')
  })

  it('ignores an alias whose member is not in the members list', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [{ alias_email: 'orphan@test', member_id: 'm-missing' }],
      members: [],
      contacts: [],
    })
    expect(aliasMap.size).toBe(0)
  })

  it('lowercases alias emails', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [{ alias_email: 'Books@Gmail.TEST', member_id: amanda.id }],
      members: [amanda],
      contacts: [],
    })
    expect(resolveEmail('books@gmail.test', aliasMap)).toBe('amanda@aol.test')
  })

  it('tolerates contacts and members with null emails', () => {
    const { aliasMap, runEmailByMemberId } = buildMembersRunAliasMap({
      aliases: [],
      members: [{ id: 'm-null', email: null, kajabi_id: 'k-null' }],
      contacts: [{ kajabi_contact_id: 'k-null', email: null }],
    })
    expect(aliasMap.size).toBe(0)
    expect(runEmailByMemberId.has('m-null')).toBe(false)
  })

  it('matches kajabi ids stored as numbers or strings', () => {
    const { runEmailByMemberId } = buildMembersRunAliasMap({
      aliases: [],
      members: [{ id: 'm1', email: 'old@test', kajabi_id: '123' }],
      contacts: [{ kajabi_contact_id: 123 as unknown as string, email: 'new@test' }],
    })
    expect(runEmailByMemberId.get('m1')).toBe('new@test')
  })

  it('sends both rows of a stale duplicate pair (same kajabi_id) to the new email', () => {
    const { runEmailByMemberId, aliasMap } = buildMembersRunAliasMap({
      aliases: [],
      members: [
        { id: 'm-orig', email: 'old@test', kajabi_id: 'k1' },
        { id: 'm-dup', email: 'new@test', kajabi_id: 'k1' },
      ],
      contacts: [{ kajabi_contact_id: 'k1', email: 'new@test' }],
    })
    expect(runEmailByMemberId.get('m-orig')).toBe('new@test')
    expect(runEmailByMemberId.get('m-dup')).toBe('new@test')
    expect(aliasMap.get('old@test')).toBe('new@test')
  })

  it('follows an alias to a member whose email changed twice without chaining through old addresses', () => {
    const { aliasMap } = buildMembersRunAliasMap({
      aliases: [
        { alias_email: 'first@test', member_id: 'm1' },
        { alias_email: 'second@test', member_id: 'm1' },
      ],
      members: [{ id: 'm1', email: 'second@test', kajabi_id: 'k1' }],
      contacts: [{ kajabi_contact_id: 'k1', email: 'third@test' }],
    })
    expect(aliasMap.get('first@test')).toBe('third@test')
    expect(aliasMap.get('second@test')).toBe('third@test')
  })
})

describe('partitionEmailConflicts', () => {
  const members = [
    { id: 'm-x', email: 'x@test', kajabi_id: 'k-x' },
    { id: 'm-y', email: 'y@test', kajabi_id: 'k-y' },
    { id: 'm-staff', email: 'staff@test', kajabi_id: null },
  ]

  it('keeps rows whose email is unchanged', () => {
    const { rows, conflicts } = partitionEmailConflicts([{ email: 'x@test', kajabi_id: 'k-x' }], members)
    expect(rows).toHaveLength(1)
    expect(conflicts).toEqual([])
  })

  it('keeps rows moving to a free email', () => {
    const { rows, conflicts } = partitionEmailConflicts([{ email: 'x-new@test', kajabi_id: 'k-x' }], members)
    expect(rows).toHaveLength(1)
    expect(conflicts).toEqual([])
  })

  it('holds back a row whose new email belongs to a different member', () => {
    const { rows, conflicts } = partitionEmailConflicts([{ email: 'y@test', kajabi_id: 'k-x' }], members)
    expect(rows).toEqual([])
    expect(conflicts).toEqual([
      { kajabi_id: 'k-x', email: 'y@test', member_ids: ['m-x'], conflicting_member_id: 'm-y' },
    ])
  })

  it('matches the holder case-insensitively', () => {
    const { conflicts } = partitionEmailConflicts([{ email: 'Y@TEST', kajabi_id: 'k-x' }], members)
    expect(conflicts).toHaveLength(1)
  })

  it('does not flag a stale duplicate that shares the kajabi_id', () => {
    const { rows, conflicts } = partitionEmailConflicts(
      [{ email: 'new@test', kajabi_id: 'k1' }],
      [
        { id: 'm-orig', email: 'old@test', kajabi_id: 'k1' },
        { id: 'm-dup', email: 'new@test', kajabi_id: 'k1' },
      ]
    )
    expect(rows).toHaveLength(1)
    expect(conflicts).toEqual([])
  })

  it('never flags brand-new contacts (no member with that kajabi_id): the insert path upserts by email', () => {
    const { rows, conflicts } = partitionEmailConflicts([{ email: 'y@test', kajabi_id: 'k-new' }], members)
    expect(rows).toHaveLength(1)
    expect(conflicts).toEqual([])
  })

  it('never flags staff-only rows (no kajabi_id)', () => {
    const { rows, conflicts } = partitionEmailConflicts([{ email: 'y@test', kajabi_id: null }], members)
    expect(rows).toHaveLength(1)
    expect(conflicts).toEqual([])
  })

  it('flags a holder even when the holder is moving away this run (resolves next run)', () => {
    const { rows, conflicts } = partitionEmailConflicts(
      [
        { email: 'y@test', kajabi_id: 'k-x' },
        { email: 'y-new@test', kajabi_id: 'k-y' },
      ],
      members
    )
    expect(rows.map((r) => r.kajabi_id)).toEqual(['k-y'])
    expect(conflicts.map((c) => c.kajabi_id)).toEqual(['k-x'])
  })

  it('keeps every other row, in order, when some conflict', () => {
    const input = [
      { email: 'a@test', kajabi_id: null, tag: 1 },
      { email: 'y@test', kajabi_id: 'k-x', tag: 2 },
      { email: 'b@test', kajabi_id: 'k-new', tag: 3 },
      { email: 'staff@test', kajabi_id: 'k-y', tag: 4 },
    ]
    const { rows, conflicts } = partitionEmailConflicts(input, members)
    expect(rows.map((r) => r.tag)).toEqual([1, 3])
    expect(conflicts.map((c) => [c.kajabi_id, c.conflicting_member_id])).toEqual([
      ['k-x', 'm-y'],
      ['k-y', 'm-staff'],
    ])
  })
})
