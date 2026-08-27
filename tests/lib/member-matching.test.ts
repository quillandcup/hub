import { describe, it, expect } from 'vitest'
import { normalizeName, matchAttendeeToMember, batchMatchAttendees, type Member, type MemberAlias, type MemberEmailAlias, type MatchResult } from '@/lib/member-matching'

describe('Member Matching', () => {
  const mockMembers: Member[] = [
    { id: '1', name: 'Member 13', email: 'member13@example.com' },
    { id: '2', name: 'Member 33', email: 'member33@example.com' },
    { id: '3', name: 'Member 17', email: 'member17@example.com' },
    { id: '4', name: 'Member 20', email: 'member20@example.com' },
  ]

  const mockAliases: MemberAlias[] = [
    { member_id: '1', alias: 'member13-display', source: 'zoom' },
    { member_id: '3', alias: 'Member 17', source: 'zoom' },
    { member_id: '4', alias: 'Kase', source: 'zoom' },
    { member_id: '4', alias: 'Member 20', source: 'zoom' },
  ]

  describe('normalizeName', () => {
    it('should lowercase names', () => {
      expect(normalizeName('Member 33')).toBe('member 33')
    })

    it('should remove special characters', () => {
      expect(normalizeName("Member 13's Name!")).toBe('member 13s name')
    })

    it('should collapse multiple spaces', () => {
      expect(normalizeName('John    Doe')).toBe('john doe')
    })

    it('should trim whitespace', () => {
      expect(normalizeName('  Member 33  ')).toBe('member 33')
    })

    it('should handle all transformations together', () => {
      expect(normalizeName("  L. M. member13-display's  Name!!  ")).toBe('l m member13displays name')
    })
  })

  describe('matchAttendeeToMember', () => {
    it('should match by email (highest priority)', () => {
      const result = matchAttendeeToMember(
        'Wrong Name',
        'member13@example.com',
        mockMembers,
        mockAliases
      )

      expect(result).toEqual({
        member_id: '1',
        confidence: 'high',
        method: 'email'
      })
    })

    it('should match by email case-insensitively', () => {
      const result = matchAttendeeToMember(
        'Wrong Name',
        'MEMBER13@EXAMPLE.COM',
        mockMembers,
        mockAliases
      )

      expect(result).toEqual({
        member_id: '1',
        confidence: 'high',
        method: 'email'
      })
    })

    it('should match by alias when no email', () => {
      const result = matchAttendeeToMember(
        'member13-display',
        null,
        mockMembers,
        mockAliases
      )

      expect(result).toEqual({
        member_id: '1',
        confidence: 'high',
        method: 'alias'
      })
    })

    it('should match by normalized name when no email or alias', () => {
      const result = matchAttendeeToMember(
        'Member 33',
        null,
        mockMembers,
        mockAliases
      )

      expect(result).toEqual({
        member_id: '2',
        confidence: 'high',
        method: 'normalized_name'
      })
    })

    it('should match normalized name with punctuation differences', () => {
      const members: Member[] = [{ id: '7', name: 'Dana Reyes', email: 'dana@example.com' }]

      const result = matchAttendeeToMember('Dana Reyes!!', null, members, [])

      expect(result).not.toBeNull()
      expect((result as MatchResult)?.member_id).toBe('7')
      expect((result as MatchResult)?.method).toBe('normalized_name')
    })

    it('should prioritize email over alias', () => {
      const result = matchAttendeeToMember(
        'member13-display', // This is an alias for member 1
        'member33@example.com', // But email is for member 2
        mockMembers,
        mockAliases
      )

      // Email match should win
      expect((result as MatchResult)?.member_id).toBe('2')
      expect((result as MatchResult)?.method).toBe('email')
    })

    it('should prioritize alias over normalized name', () => {
      const result = matchAttendeeToMember(
        'Member 17', // Alias for member 3
        null,
        mockMembers,
        mockAliases
      )

      expect((result as MatchResult)?.member_id).toBe('3')
      expect((result as MatchResult)?.method).toBe('alias')
    })

    it('should support multiple aliases for same member', () => {
      const result1 = matchAttendeeToMember('Kase', null, mockMembers, mockAliases)
      const result2 = matchAttendeeToMember('Member 20', null, mockMembers, mockAliases)

      expect((result1 as MatchResult)?.member_id).toBe('4')
      expect((result2 as MatchResult)?.member_id).toBe('4')
    })

    it('should return null when no match found', () => {
      const result = matchAttendeeToMember(
        'Unknown Person',
        'unknown@example.com',
        mockMembers,
        mockAliases
      )

      expect(result).toBeNull()
    })
  })

  describe('batchMatchAttendees', () => {
    it('should match multiple attendees', () => {
      const attendees = [
        { name: 'member13-display', email: null },
        { name: 'Member 33', email: 'member33@example.com' },
        { name: 'Kase', email: null },
        { name: 'Unknown Person', email: null },
      ]

      const result = batchMatchAttendees(attendees, mockMembers, mockAliases)

      expect(result.matches).toHaveLength(3)
      expect(result.unmatched).toHaveLength(1)
      expect(result.unmatched[0].name).toBe('Unknown Person')
    })

    it('should provide match method for each result', () => {
      const attendees = [
        { name: 'member13-display', email: null }, // alias match
        { name: 'Member 20', email: 'member20@example.com' }, // email match wins over its own alias
        { name: 'Member 33', email: null }, // normalized name match (no alias defined for this one)
      ]

      const result = batchMatchAttendees(attendees, mockMembers, mockAliases)

      expect(result.matches[0].match.method).toBe('alias')
      expect(result.matches[1].match.method).toBe('email')
      expect(result.matches[2].match.method).toBe('normalized_name')
    })
  })

  describe('email alias matching (merged members)', () => {
    const members: Member[] = [
      { id: 'primary', name: 'Alice Writer', email: 'alice@primary.com' },
      { id: 'other', name: 'Other Person', email: 'other@example.com' },
    ]
    const emailAliases: MemberEmailAlias[] = [
      { alias_email: 'alice@oldaccount.com', canonical_email: 'alice@primary.com' },
    ]

    it('matches attendee by email alias after member merge', () => {
      const result = matchAttendeeToMember(
        'Alice Writer',
        'alice@oldaccount.com',
        members,
        [],
        emailAliases
      )
      expect(result).toEqual({ member_id: 'primary', confidence: 'high', method: 'email' })
    })

    it('canonical email still takes priority over alias', () => {
      const result = matchAttendeeToMember(
        'Alice Writer',
        'alice@primary.com',
        members,
        [],
        emailAliases
      )
      expect(result).toEqual({ member_id: 'primary', confidence: 'high', method: 'email' })
    })

    it('email alias takes priority over name alias', () => {
      const nameAliases: MemberAlias[] = [
        { member_id: 'other', alias: 'Alice Writer', source: 'zoom' },
      ]
      const result = matchAttendeeToMember(
        'Alice Writer',
        'alice@oldaccount.com',
        members,
        nameAliases,
        emailAliases
      )
      expect((result as MatchResult).member_id).toBe('primary')
    })

    it('email alias match is case-insensitive', () => {
      const result = matchAttendeeToMember(
        'Alice Writer',
        'ALICE@OLDACCOUNT.COM',
        members,
        [],
        emailAliases
      )
      expect((result as MatchResult).member_id).toBe('primary')
    })

    it('does not use alias when canonical email is not a known member', () => {
      // A broken alias (canonical_email not in members) should not match via the alias path.
      // Use a name that also has no match so we can confirm nothing resolves.
      const brokenAliases: MemberEmailAlias[] = [
        { alias_email: 'alice@oldaccount.com', canonical_email: 'nonexistent@example.com' },
      ]
      const result = matchAttendeeToMember(
        'Unknown Attendee',
        'alice@oldaccount.com',
        members,
        [],
        brokenAliases
      )
      expect(result).toBeNull()
    })

    it('secondary email returns null without email aliases (backward compatible)', () => {
      // Without emailAliases, an attendee whose only identifier is a former secondary
      // email and a non-matching name should not resolve.
      const result = matchAttendeeToMember(
        'Unknown Attendee',
        'alice@oldaccount.com',
        members,
        []
      )
      expect(result).toBeNull()
    })
  })

  describe('Real-world edge cases', () => {
    it('should handle Zoom names with trailing spaces', () => {
      const result = matchAttendeeToMember(
        'Allison ', // Note the trailing space (actual Zoom data)
        null,
        [{ id: '5', name: 'Member 14', email: 'allison@example.com' }],
        [{ member_id: '5', alias: 'Allison ', source: 'zoom' as const }] // Alias includes the space
      )

      expect((result as MatchResult)?.member_id).toBe('5')
    })

    it('should handle names that differ only in punctuation', () => {
      const members: Member[] = [
        { id: '6', name: 'Member 19', email: 'member19@example.com' }
      ]
      const aliases: MemberAlias[] = [
        { member_id: '6', alias: 'member19-display', source: 'zoom' }
      ]

      const result = matchAttendeeToMember('member19-display', null, members, aliases)

      expect((result as MatchResult)?.member_id).toBe('6')
    })
  })
})
