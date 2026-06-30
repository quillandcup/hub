import { describe, it, expect } from 'vitest'
import { findUnmatchedZoomAttendees } from '@/lib/prickle-unmatched'
import type { Member, MemberAlias } from '@/lib/member-matching'

const members: Member[] = [
  { id: '1', name: 'Member 57', email: 'elle@example.com' },
  { id: '2', name: 'Jade Tennant', email: 'jade@example.com' },
  { id: '3', name: 'Member 10', email: 'jude@example.com' },
]

const aliases: MemberAlias[] = [
  { member_id: '1', alias: 'Elle', source: 'zoom' },
]

describe('findUnmatchedZoomAttendees', () => {
  it('returns empty array when all attendees match', () => {
    const zoom = [
      { name: 'Member 57', email: 'elle@example.com' },
      { name: 'Jade Tennant', email: null },
    ]
    expect(findUnmatchedZoomAttendees(zoom, members, aliases, [])).toEqual([])
  })

  it('returns attendees that have no match', () => {
    const zoom = [
      { name: 'Member 57', email: null },
      { name: 'Mystery Person', email: null },
    ]
    const result = findUnmatchedZoomAttendees(zoom, members, aliases, [])
    expect(result).toHaveLength(1)
    expect(result[0].zoomName).toBe('Mystery Person')
  })

  it('excludes ignored names even if unmatched', () => {
    const zoom = [
      { name: 'Mystery Person', email: null },
      { name: 'Zoom Recorder', email: null },
    ]
    const result = findUnmatchedZoomAttendees(zoom, members, aliases, ['Zoom Recorder'])
    expect(result).toHaveLength(1)
    expect(result[0].zoomName).toBe('Mystery Person')
  })

  it('deduplicates the same zoom name into one entry', () => {
    const zoom = [
      { name: 'Mystery Person', email: null },
      { name: 'Mystery Person', email: null },
      { name: 'Mystery Person', email: 'mystery@example.com' },
    ]
    const result = findUnmatchedZoomAttendees(zoom, members, aliases, [])
    expect(result).toHaveLength(1)
    expect(result[0].appearances).toBe(3)
  })

  it('collects all distinct emails for a zoom name', () => {
    const zoom = [
      { name: 'Mystery Person', email: 'a@example.com' },
      { name: 'Mystery Person', email: 'b@example.com' },
      { name: 'Mystery Person', email: 'a@example.com' },
    ]
    const result = findUnmatchedZoomAttendees(zoom, members, aliases, [])
    expect(result[0].emails).toHaveLength(2)
    expect(result[0].emails).toContain('a@example.com')
    expect(result[0].emails).toContain('b@example.com')
  })

  it('matches via email even when name does not match', () => {
    const zoom = [{ name: 'E. Lowery', email: 'elle@example.com' }]
    expect(findUnmatchedZoomAttendees(zoom, members, aliases, [])).toEqual([])
  })

  it('matches via alias', () => {
    const zoom = [{ name: 'Elle', email: null }]
    expect(findUnmatchedZoomAttendees(zoom, members, aliases, [])).toEqual([])
  })

  it('returns empty array when zoom list is empty', () => {
    expect(findUnmatchedZoomAttendees([], members, aliases, [])).toEqual([])
  })

  it('returns all attendees when member list is empty', () => {
    const zoom = [
      { name: 'Member 57', email: 'elle@example.com' },
      { name: 'Jade Tennant', email: null },
    ]
    const result = findUnmatchedZoomAttendees(zoom, [], [], [])
    expect(result).toHaveLength(2)
  })

  it('includes null emails in the record without adding them to the emails list', () => {
    const zoom = [
      { name: 'Mystery Person', email: null },
    ]
    const result = findUnmatchedZoomAttendees(zoom, members, aliases, [])
    expect(result[0].emails).toHaveLength(0)
    expect(result[0].appearances).toBe(1)
  })

  describe('staff filtering', () => {
    const staff = [
      { name: 'Owner 1', email: 'owner1@example.com' },
      { name: 'Jane Staff', email: 'jane@quillandcup.com' },
    ]

    it('excludes staff matched by name', () => {
      const zoom = [
        { name: 'Owner 1', email: 'owner1@example.com' },
        { name: 'Mystery Person', email: null },
      ]
      const result = findUnmatchedZoomAttendees(zoom, members, aliases, [], staff)
      expect(result).toHaveLength(1)
      expect(result[0].zoomName).toBe('Mystery Person')
    })

    it('excludes staff matched by email even when zoom name differs', () => {
      const zoom = [
        { name: 'A. Ray', email: 'owner1@example.com' },
        { name: 'Mystery Person', email: null },
      ]
      const result = findUnmatchedZoomAttendees(zoom, members, aliases, [], staff)
      expect(result).toHaveLength(1)
      expect(result[0].zoomName).toBe('Mystery Person')
    })

    it('staff name match is case-insensitive', () => {
      const zoom = [{ name: 'ania ray', email: null }]
      expect(findUnmatchedZoomAttendees(zoom, members, aliases, [], staff)).toEqual([])
    })

    it('staff email match is case-insensitive', () => {
      const zoom = [{ name: 'Owner 1', email: 'OWNER1@EXAMPLE.COM' }]
      expect(findUnmatchedZoomAttendees(zoom, members, aliases, [], staff)).toEqual([])
    })

    it('returns all unmatched non-staff attendees unchanged when staff list is empty', () => {
      const zoom = [{ name: 'Mystery Person', email: null }]
      const result = findUnmatchedZoomAttendees(zoom, members, aliases, [], [])
      expect(result).toHaveLength(1)
    })

    it('does not affect members who happen to share a name with staff', () => {
      const membersWithStaffName: Member[] = [
        ...members,
        { id: '99', name: 'Owner 1', email: 'ania-member@example.com' },
      ]
      const zoom = [{ name: 'Owner 1', email: 'ania-member@example.com' }]
      // Staff name match would suppress, but member match also fires — either way not in unmatched
      expect(findUnmatchedZoomAttendees(zoom, membersWithStaffName, aliases, [], staff)).toEqual([])
    })
  })
})
