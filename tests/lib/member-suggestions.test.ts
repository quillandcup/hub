import { describe, it, expect } from 'vitest'
import { suggestMemberMatches, type Member } from '@/lib/member-matching'

describe('suggestMemberMatches', () => {
  const members: Member[] = [
    { id: '1', name: 'Alice Johnson', email: 'alice.johnson@example.com' },
    { id: '2', name: 'Alicia Johnson', email: 'alicia.j@example.com' },
    { id: '3', name: 'Bob Smith', email: 'bob@example.com' },
    { id: '4', name: 'Charlie Brown', email: 'charlie@example.com' },
  ]

  it('suggests a close name match', () => {
    const suggestions = suggestMemberMatches('Alice Jonson', null, members)
    expect(suggestions[0].member.id).toBe('1')
  })

  it('surfaces a candidate via exact email local-part match despite a dissimilar name', () => {
    const suggestions = suggestMemberMatches('Robbie S', 'bob@example.com', members)
    expect(suggestions[0].member.id).toBe('3')
  })

  it('excludes an exact normalized-name match (handled upstream, never truly unmatched)', () => {
    const suggestions = suggestMemberMatches('Bob Smith', null, members)
    expect(suggestions.some((s) => s.member.id === '3')).toBe(false)
  })

  it('returns an empty list when nothing is close enough', () => {
    const suggestions = suggestMemberMatches('Zzyzx Qwerty', 'nobody@nowhere.com', members)
    expect(suggestions).toEqual([])
  })

  it('caps results at the requested limit', () => {
    const suggestions = suggestMemberMatches('Alice Johnson', null, members, 1)
    expect(suggestions.length).toBeLessThanOrEqual(1)
  })

  describe('nickname/first-name input against a long full name', () => {
    // Regression: a short Slack real_name (e.g. a single nickname) was scored
    // against the entire long member name via whole-string edit distance, so
    // the length mismatch swamped the fact that the nickname is an exact
    // token in the name — meanwhile unrelated short names scored better
    // purely by being similarly short. Token-level matching fixes this.
    const longNameMembers: Member[] = [
      { id: '1', name: 'Zora Middlebrook/Zee Vance', email: 'zee.vance.writer@example.com' },
      { id: '2', name: 'Priya Chen', email: 'priya@example.com' },
      { id: '3', name: 'Zoe X', email: 'zoex@example.com' },
    ]

    it('finds the long name via an exact token match on the short input', () => {
      const suggestions = suggestMemberMatches(
        'Zora',
        'zoraeve@example.net',
        longNameMembers
      )
      expect(suggestions[0].member.id).toBe('1')
      expect(suggestions[0].score).toBe(1)
    })

    it('does not surface unrelated short names ahead of the real token match', () => {
      const suggestions = suggestMemberMatches(
        'Zora',
        'zoraeve@example.net',
        longNameMembers
      )
      expect(suggestions.some((s) => s.member.id === '2')).toBe(false)
    })
  })
})
