import { describe, it, expect } from 'vitest'
import { memberIdsWithAccess, segmentSourceChoices, isSegmentSourceType } from '@/lib/segment-sources'
import { useFakeClock } from '../helpers/fake-clock'

const NOW = Date.parse('2027-01-15T12:00:00Z')
const access = (member_id: string, starts_at: string, ends_at: string | null) => ({ member_id, course_id: 'c1', origin: 'purchase', starts_at, ends_at })

function repos(overrides: Record<string, unknown> = {}) {
  return {
    courses: {
      courseById: async (id: string) => (id === 'c1' ? { id } : null),
      courses: async () => [{ id: 'c1', title: 'Course One' }],
    },
    courseProgress: {
      accessOfCourses: async () => [
        access('m1', '2026-01-01T00:00:00Z', null),
        access('m1', '2026-06-01T00:00:00Z', null),
        access('m2', '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'),
        access('m3', '2027-02-01T00:00:00Z', null),
        access('m4', '2026-01-01T00:00:00Z', '2027-03-01T00:00:00Z'),
      ],
    },
    programs: {
      byId: async (id: string) => (id === 'p1' ? { id } : null),
      names: async () => [{ id: 'p1', name: 'Program One' }],
      cohortsWithEnrollments: async () => [
        { member_program_enrollments: [{ member: { id: 'm1' } }, { member: { id: 'm5' } }, { member: null }] },
        { member_program_enrollments: [{ member: { id: 'm5' } }] },
      ],
    },
    events: {
      byId: async (id: string) => (id === 'e1' ? { id } : null),
      choices: async () => [{ id: 'e1', title: 'Event One', starts_at: '2027-01-01T00:00:00Z' }],
      attendeesOf: async () => [{ member_id: 'm6' }, { member_id: 'm6' }, { member_id: 'm7' }],
    },
    ...overrides,
  } as unknown as Parameters<typeof memberIdsWithAccess>[0]
}

describe('segment sources', () => {
  useFakeClock(() => NOW)

  it('lists every course, program and event', async () => {
    expect(await segmentSourceChoices(repos())).toEqual([
      { type: 'course', id: 'c1', name: 'Course One' },
      { type: 'program', id: 'p1', name: 'Program One' },
      { type: 'event', id: 'e1', name: 'Event One · Thu, Dec 31, 2026, 7:00 PM EST' },
    ])
  })

  it('tells events with the same title apart by their Eastern date and time', async () => {
    const same = repos({
      events: {
        choices: async () => [
          { id: 'e1', title: 'Pitch Prickle', starts_at: '2026-12-04T20:00:00Z' },
          { id: 'e2', title: 'Pitch Prickle', starts_at: '2026-07-10T19:00:00Z' },
        ],
      },
    })
    const names = (await segmentSourceChoices(same)).filter((c) => c.type === 'event').map((c) => c.name)
    expect(names).toEqual(['Pitch Prickle · Fri, Dec 4, 2026, 3:00 PM EST', 'Pitch Prickle · Fri, Jul 10, 2026, 3:00 PM EDT'])
  })

  it('counts only course access that has started and not ended', async () => {
    expect((await memberIdsWithAccess(repos(), 'course', 'c1'))?.sort()).toEqual(['m1', 'm4'])
  })

  it('counts a program member once across cohorts', async () => {
    expect((await memberIdsWithAccess(repos(), 'program', 'p1'))?.sort()).toEqual(['m1', 'm5'])
  })

  it('counts an event attendee once', async () => {
    expect((await memberIdsWithAccess(repos(), 'event', 'e1'))?.sort()).toEqual(['m6', 'm7'])
  })

  it('returns null for a source that does not exist', async () => {
    for (const type of ['course', 'program', 'event'] as const) {
      expect(await memberIdsWithAccess(repos(), type, 'missing')).toBeNull()
    }
  })

  it('recognizes the source types', () => {
    expect(isSegmentSourceType('course')).toBe(true)
    expect(isSegmentSourceType('badge')).toBe(false)
    expect(isSegmentSourceType(undefined)).toBe(false)
  })
})
