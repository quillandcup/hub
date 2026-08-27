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
})
