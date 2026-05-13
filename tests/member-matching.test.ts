import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from './helpers/supabase'
import { matchAttendeeToMember, normalizeName, type Member, type MemberAlias, type MatchResult } from '../lib/member-matching'

/**
 * Tests for centralized member matching library
 *
 * NOTE: These tests were migrated from the old database function approach.
 * Fuzzy matching tests were removed as that feature is not in the new implementation.
 */
describe('member matching library', () => {
  const adminClient = getTestSupabaseAdminClient()
  let testMemberId: string
  let testMemberEmail: string
  const testEmail = 'test.member@example.com'

  beforeAll(async () => {
    // Clean up any existing test member from previous runs
    await adminClient.from('members').delete().eq('email', testEmail)

    // Create a test member for matching
    const { data, error } = await adminClient
      .from('members')
      .insert({
        name: 'Test Member',
        email: testEmail,
        joined_at: new Date().toISOString(),
        status: 'active',
      })
      .select()
      .single()

    if (error) throw error
    testMemberId = data.id
    testMemberEmail = data.email
  })

  afterEach(async () => {
    // Clean up any test aliases after each test
    await adminClient
      .from('member_name_aliases')
      .delete()
      .eq('member_id', testMemberId)
  })

  afterAll(async () => {
    // Clean up test member
    await adminClient.from('members').delete().eq('id', testMemberId)
  })

  /**
   * Helper to load members and aliases from DB and call matching function
   */
  async function matchMember(
    zoom_name: string,
    zoom_email: string | null = null
  ): Promise<MatchResult | null> {
    const { data: members } = await adminClient
      .from('members')
      .select('id, name, email')

    const { data: aliases } = await adminClient
      .from('member_name_aliases')
      .select('member_id, alias, source')

    const result = matchAttendeeToMember(
      zoom_name,
      zoom_email,
      members as Member[] || [],
      aliases as MemberAlias[] || []
    )
    return result && 'member_id' in result ? result : null
  }

  describe('normalizeName function', () => {
    it('should convert to lowercase', () => {
      expect(normalizeName('TEST MEMBER')).toBe('test member')
    })

    it('should remove punctuation', () => {
      expect(normalizeName("O'Brien")).toBe('obrien')
    })

    it('should collapse multiple spaces', () => {
      expect(normalizeName('Test   Member')).toBe('test member')
    })

    it('should trim whitespace', () => {
      expect(normalizeName('  Test Member  ')).toBe('test member')
    })
  })

  describe('email matching', () => {
    it('should match by exact email (high confidence)', async () => {
      const result = await matchMember('Any Name', testMemberEmail)

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.confidence).toBe('high')
      expect(result?.method).toBe('email')
    })

    it('should match by email regardless of case', async () => {
      const result = await matchMember('Any Name', testMemberEmail.toUpperCase())

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.method).toBe('email')
    })

    it('should prioritize email match over name match', async () => {
      const result = await matchMember('Test Member', testMemberEmail)

      expect(result?.method).toBe('email')
    })

    it('should not match invalid email', async () => {
      const result = await matchMember('Test Member', 'nonexistent@example.com')

      // Should fall through to normalized name match
      expect(result?.method).not.toBe('email')
    })
  })

  describe('alias matching', () => {
    it('should match by exact alias (high confidence)', async () => {
      // Create alias
      await adminClient.from('member_name_aliases').insert({
        member_id: testMemberId,
        alias: 'TM',
      })

      const result = await matchMember('TM')

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.confidence).toBe('high')
      expect(result?.method).toBe('alias')
    })

    it('should match multiple aliases for same member', async () => {
      // Create multiple aliases
      await adminClient.from('member_name_aliases').insert([
        { member_id: testMemberId, alias: 'TM' },
        { member_id: testMemberId, alias: 'TestM' },
      ])

      const result1 = await matchMember('TM')
      const result2 = await matchMember('TestM')

      expect(result1?.member_id).toBe(testMemberId)
      expect(result2?.member_id).toBe(testMemberId)
    })

    it('should prioritize alias over normalized match', async () => {
      await adminClient.from('member_name_aliases').insert({
        member_id: testMemberId,
        alias: 'Test Member',
      })

      const result = await matchMember('Test Member')

      expect(result?.method).toBe('alias')
    })
  })

  describe('normalized name matching', () => {
    it('should match by normalized name (high confidence)', async () => {
      const result = await matchMember('Test Member')

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.confidence).toBe('high')
      expect(result?.method).toBe('normalized_name')
    })

    it('should match case-insensitive', async () => {
      const result = await matchMember('TEST MEMBER')

      expect(result?.member_id).toBe(testMemberId)
      expect(result?.method).toBe('normalized_name')
    })

    it('should match with extra whitespace', async () => {
      const result = await matchMember('  Test   Member  ')

      expect(result?.member_id).toBe(testMemberId)
      expect(result?.method).toBe('normalized_name')
    })

    it('should match with punctuation differences', async () => {
      // Create member with punctuation
      const { data } = await adminClient
        .from('members')
        .insert({
          name: "O'Brien",
          email: 'obrien@example.com',
          joined_at: new Date().toISOString(),
          status: 'active',
        })
        .select()
        .single()

      const result = await matchMember('OBrien')

      expect(result?.member_id).toBe(data!.id)
      expect(result?.method).toBe('normalized_name')

      // Cleanup
      await adminClient.from('members').delete().eq('id', data!.id)
    })
  })

  describe('no match scenarios', () => {
    it('should return null for non-existent name', async () => {
      const result = await matchMember('Nonexistent Person')

      expect(result).toBeNull()
    })

    it('should return null for empty string', async () => {
      const result = await matchMember('')

      expect(result).toBeNull()
    })

    it('should return null when no email provided and name does not match', async () => {
      const result = await matchMember('Random Name', null)

      expect(result).toBeNull()
    })
  })

  describe('confidence scoring', () => {
    it('should return high confidence for email match', async () => {
      const result = await matchMember('Any Name', testMemberEmail)
      expect(result?.confidence).toBe('high')
    })

    it('should return high confidence for alias match', async () => {
      await adminClient.from('member_name_aliases').insert({
        member_id: testMemberId,
        alias: 'TM',
      })

      const result = await matchMember('TM')
      expect(result?.confidence).toBe('high')
    })

    it('should return high confidence for normalized match', async () => {
      const result = await matchMember('TEST MEMBER')
      expect(result?.confidence).toBe('high')
    })
  })

  describe('match priority', () => {
    it('should prioritize: email > alias > normalized', async () => {
      // Set up alias
      await adminClient.from('member_name_aliases').insert({
        member_id: testMemberId,
        alias: 'Test Member',
      })

      // All these should match, but with different priorities
      const emailMatch = await matchMember('Wrong Name', testMemberEmail)
      const aliasMatch = await matchMember('Test Member')

      expect(emailMatch?.method).toBe('email')
      expect(aliasMatch?.method).toBe('alias') // alias wins over normalized

      // Clean up alias
      await adminClient.from('member_name_aliases').delete().eq('member_id', testMemberId)

      const normalizedMatch = await matchMember('test member')
      expect(normalizedMatch?.method).toBe('normalized_name')
    })
  })
})
