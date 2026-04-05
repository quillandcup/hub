import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { getTestSupabaseClient } from './helpers/supabase'

interface MatchResult {
  member_id: string
  confidence: 'high' | 'medium' | 'low'
  match_type: 'email' | 'alias' | 'normalized' | 'fuzzy'
}

describe('match_member_by_name function', () => {
  const supabase = getTestSupabaseClient()
  let testMemberId: string
  let testMemberEmail: string

  beforeAll(async () => {
    // Create a test member for matching
    const { data, error } = await supabase
      .from('members')
      .insert({
        name: 'Test Member',
        email: 'test.member@example.com',
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
    await supabase
      .from('member_name_aliases')
      .delete()
      .eq('member_id', testMemberId)
  })

  async function matchMember(
    zoom_name: string,
    zoom_email: string | null = null
  ): Promise<MatchResult | null> {
    const { data, error } = await supabase.rpc('match_member_by_name', {
      zoom_name,
      zoom_email,
    })

    if (error) throw error
    return data && data.length > 0 ? data[0] : null
  }

  describe('email matching', () => {
    it('should match by exact email (high confidence)', async () => {
      const result = await matchMember('Any Name', testMemberEmail)

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.confidence).toBe('high')
      expect(result?.match_type).toBe('email')
    })

    it('should match by email regardless of case', async () => {
      const result = await matchMember('Any Name', testMemberEmail.toUpperCase())

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.match_type).toBe('email')
    })

    it('should prioritize email match over name match', async () => {
      const result = await matchMember('Test Member', testMemberEmail)

      expect(result?.match_type).toBe('email')
    })

    it('should not match invalid email', async () => {
      const result = await matchMember('Test Member', 'nonexistent@example.com')

      // Should fall through to normalized name match
      expect(result?.match_type).not.toBe('email')
    })
  })

  describe('alias matching', () => {
    it('should match by exact alias (high confidence)', async () => {
      // Create alias
      await supabase.from('member_name_aliases').insert({
        member_id: testMemberId,
        alias: 'TM',
      })

      const result = await matchMember('TM')

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.confidence).toBe('high')
      expect(result?.match_type).toBe('alias')
    })

    it('should match multiple aliases for same member', async () => {
      // Create multiple aliases
      await supabase.from('member_name_aliases').insert([
        { member_id: testMemberId, alias: 'TM' },
        { member_id: testMemberId, alias: 'TestM' },
      ])

      const result1 = await matchMember('TM')
      const result2 = await matchMember('TestM')

      expect(result1?.member_id).toBe(testMemberId)
      expect(result2?.member_id).toBe(testMemberId)
    })

    it('should prioritize alias over normalized match', async () => {
      await supabase.from('member_name_aliases').insert({
        member_id: testMemberId,
        alias: 'Test Member',
      })

      const result = await matchMember('Test Member')

      expect(result?.match_type).toBe('alias')
    })
  })

  describe('normalized name matching', () => {
    it('should match by normalized name (high confidence)', async () => {
      const result = await matchMember('Test Member')

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.confidence).toBe('high')
      expect(result?.match_type).toBe('normalized')
    })

    it('should match case-insensitive', async () => {
      const result = await matchMember('TEST MEMBER')

      expect(result?.member_id).toBe(testMemberId)
      expect(result?.match_type).toBe('normalized')
    })

    it('should match with extra whitespace', async () => {
      const result = await matchMember('  Test   Member  ')

      expect(result?.member_id).toBe(testMemberId)
      expect(result?.match_type).toBe('normalized')
    })

    it('should match with punctuation differences', async () => {
      // Create member with punctuation
      const { data } = await supabase
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
      expect(result?.match_type).toBe('normalized')

      // Cleanup
      await supabase.from('members').delete().eq('id', data!.id)
    })
  })

  describe('fuzzy matching', () => {
    it('should match similar names with typos (medium/low confidence)', async () => {
      // "Tast Member" is close to "Test Member"
      const result = await matchMember('Tast Member')

      expect(result).not.toBeNull()
      expect(result?.member_id).toBe(testMemberId)
      expect(result?.match_type).toBe('fuzzy')
      expect(['medium', 'low']).toContain(result?.confidence)
    })

    it('should return medium confidence for very similar names', async () => {
      // Very similar - just one letter off
      const result = await matchMember('Test Mumber')

      expect(result?.confidence).toBe('medium')
      expect(result?.match_type).toBe('fuzzy')
    })

    it('should not match completely different names', async () => {
      const result = await matchMember('Completely Different Name')

      expect(result).toBeNull()
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
      await supabase.from('member_name_aliases').insert({
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

    it('should return medium/low confidence for fuzzy match', async () => {
      const result = await matchMember('Tast Member')
      expect(['medium', 'low']).toContain(result?.confidence)
    })
  })

  describe('match type priority', () => {
    it('should prioritize: email > alias > normalized > fuzzy', async () => {
      // Set up alias
      await supabase.from('member_name_aliases').insert({
        member_id: testMemberId,
        alias: 'Test Member',
      })

      // All these should match, but with different priorities
      const emailMatch = await matchMember('Wrong Name', testMemberEmail)
      const aliasMatch = await matchMember('Test Member')
      const normalizedMatch = await matchMember('test member')

      expect(emailMatch?.match_type).toBe('email')
      expect(aliasMatch?.match_type).toBe('alias') // alias wins over normalized

      // Clean up alias
      await supabase.from('member_name_aliases').delete().eq('member_id', testMemberId)

      const normalizedMatch2 = await matchMember('test member')
      expect(normalizedMatch2?.match_type).toBe('normalized')
    })
  })
})
