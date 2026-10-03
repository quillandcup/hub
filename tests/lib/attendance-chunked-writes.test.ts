import { describe, it, expect } from 'vitest'
import { attendanceMatchInputsChanged, chunkAttendanceWrites } from '@/lib/processing/attendance'
import { slackUsersChangedForMembers } from '@/lib/slack-messages'

const FROM = '2026-07-01T00:00:00.000Z'
const TO = '2026-07-08T00:00:00.000Z'
const span = (start: string, end: string) => ({ start, end })
const row = (join_time: string) => ({ join_time })
const pup = (start_time: string) => ({ start_time })

describe('chunkAttendanceWrites', () => {
  it('keeps everything in one chunk when it fits', () => {
    const busy = [span('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z'), span('2026-07-03T10:00:00Z', '2026-07-03T11:00:00Z')]
    const chunks = chunkAttendanceWrites(FROM, TO, busy, [], [row('2026-07-01T10:00:00Z'), row('2026-07-03T10:00:00Z')], 10)
    expect(chunks).toEqual([{ from: FROM, to: TO, pups: [], attendance: [row('2026-07-01T10:00:00Z'), row('2026-07-03T10:00:00Z')] }])
  })

  it('cuts in the middle of quiet gaps and covers the whole range without overlap', () => {
    const busy = [
      span('2026-07-01T10:00:00Z', '2026-07-01T12:00:00Z'),
      span('2026-07-02T10:00:00Z', '2026-07-02T12:00:00Z'),
      span('2026-07-03T10:00:00Z', '2026-07-03T12:00:00Z'),
    ]
    const attendance = [row('2026-07-01T10:00:00Z'), row('2026-07-02T10:30:00Z'), row('2026-07-03T11:00:00Z')]
    const chunks = chunkAttendanceWrites(FROM, TO, busy, [pup('2026-07-02T10:00:00Z')], attendance, 2)

    expect(chunks.map((c) => [c.from, c.to])).toEqual([
      [FROM, '2026-07-01T23:00:00.000Z'],
      ['2026-07-01T23:00:00.000Z', '2026-07-02T23:00:00.000Z'],
      ['2026-07-02T23:00:00.000Z', TO],
    ])
    expect(chunks.map((c) => [c.pups.length, c.attendance.length])).toEqual([[0, 1], [1, 1], [0, 1]])
  })

  it('never cuts inside a meeting or prickle, even one crossing midnight or bridging two meetings', () => {
    const busy = [
      span('2026-07-01T23:30:00Z', '2026-07-02T00:45:00Z'), // crosses midnight UTC
      span('2026-07-03T09:00:00Z', '2026-07-03T10:00:00Z'),
      span('2026-07-03T09:50:00Z', '2026-07-03T12:00:00Z'), // calendar prickle bridging into the next meeting
      span('2026-07-03T11:30:00Z', '2026-07-03T13:00:00Z'),
    ]
    const attendance = [
      row('2026-07-01T23:30:00Z'),
      row('2026-07-02T00:10:00Z'),
      row('2026-07-03T09:00:00Z'),
      row('2026-07-03T11:45:00Z'),
    ]
    const chunks = chunkAttendanceWrites(FROM, TO, busy, [], attendance, 1)

    expect(chunks).toHaveLength(2)
    expect(chunks[0].to).toBe('2026-07-02T16:52:30.000Z') // middle of the only quiet gap
    expect(chunks[0].attendance).toEqual(attendance.slice(0, 2))
    expect(chunks[1].attendance).toEqual(attendance.slice(2))
  })

  it('returns one chunk covering the range when nothing happened', () => {
    expect(chunkAttendanceWrites(FROM, TO, [], [], [], 1)).toEqual([{ from: FROM, to: TO, pups: [], attendance: [] }])
  })

  it('ignores activity outside the range when placing cuts', () => {
    const busy = [span('2026-06-30T22:00:00Z', '2026-07-01T01:00:00Z'), span('2026-07-02T10:00:00Z', '2026-07-02T11:00:00Z')]
    const chunks = chunkAttendanceWrites(FROM, TO, busy, [], [row('2026-07-01T00:30:00Z'), row('2026-07-02T10:00:00Z')], 1)
    expect(chunks.map((c) => c.attendance.length)).toEqual([1, 1])
    expect(chunks[0].from).toBe(FROM)
  })
})

describe('attendanceMatchInputsChanged', () => {
  const m = (id: string, name: string, email: string | null) => ({ id, name, email })

  it('is false when every member keeps the same id, name and email, in any order', () => {
    expect(attendanceMatchInputsChanged([m('1', 'A', 'a@x'), m('2', 'B', null)], [m('2', 'B', null), m('1', 'A', 'a@x')])).toBe(false)
  })

  it('is true when a member is added, renamed or changes email', () => {
    const before = [m('1', 'A', 'a@x')]
    expect(attendanceMatchInputsChanged(before, [m('1', 'A', 'a@x'), m('2', 'B', 'b@x')])).toBe(true)
    expect(attendanceMatchInputsChanged(before, [m('1', 'Alice', 'a@x')])).toBe(true)
    expect(attendanceMatchInputsChanged(before, [m('1', 'A', 'alice@x')])).toBe(true)
  })
})

describe('slackUsersChangedForMembers', () => {
  const u = (user_id: string, email: string | null, image_url: string | null) => ({ user_id, email, image_url })

  it('is false when no user is new and none changed email or avatar', () => {
    expect(slackUsersChangedForMembers([u('U1', 'a@x', 'img1'), u('U2', null, null)], [u('U2', null, null), u('U1', 'a@x', 'img1')])).toBe(false)
  })

  it('is true for a new user, a changed email or a changed avatar', () => {
    const stored = [u('U1', 'a@x', 'img1')]
    expect(slackUsersChangedForMembers(stored, [u('U1', 'a@x', 'img1'), u('U2', 'b@x', null)])).toBe(true)
    expect(slackUsersChangedForMembers(stored, [u('U1', 'new@x', 'img1')])).toBe(true)
    expect(slackUsersChangedForMembers(stored, [u('U1', 'a@x', 'img2')])).toBe(true)
  })

  it('treats a missing avatar and a null one as the same', () => {
    expect(slackUsersChangedForMembers([u('U1', 'a@x', null)], [{ user_id: 'U1', email: 'a@x', image_url: undefined as any }])).toBe(false)
  })
})
