import { describe, expect, it } from 'vitest'
import { MAX_SEGMENTS_PER_BATCH, parseWatchBatch, resumeSeconds } from '@/lib/courses/watch'

const LESSON = '00000000-0000-4000-a000-00000000c200'
const SESSION = '00000000-0000-4000-a000-00000000c999'
const segment = { start: 1, end: 9.5, rate: 1.5, captions: 'English', visible: true }
const batch = (over: Record<string, unknown> = {}) => ({ lessonId: LESSON, sessionId: SESSION, segments: [segment], position: 9.5, ...over })

describe('parseWatchBatch', () => {
  it('accepts a well-formed batch', () => {
    expect(parseWatchBatch(batch())).toEqual({ lessonId: LESSON, sessionId: SESSION, segments: [segment], position: 9.5 })
  })

  it('takes a position-only update, and a missing position as none', () => {
    expect(parseWatchBatch(batch({ segments: [] }))?.segments).toEqual([])
    expect(parseWatchBatch(batch({ position: undefined }))?.position).toBeNull()
    expect(parseWatchBatch(batch({ position: null }))?.position).toBeNull()
  })

  it('takes captions off as null', () => {
    expect(parseWatchBatch(batch({ segments: [{ ...segment, captions: null }] }))?.segments[0].captions).toBeNull()
  })

  it.each([
    ['not an object', 'nope'],
    ['no lesson id', batch({ lessonId: undefined })],
    ['a lesson id that is not a uuid', batch({ lessonId: 'abc' })],
    ['a session id that is not a uuid', batch({ sessionId: 'abc' })],
    ['segments that are not a list', batch({ segments: {} })],
    ['too many segments', batch({ segments: Array(MAX_SEGMENTS_PER_BATCH + 1).fill(segment) })],
    ['a segment ending before it starts', batch({ segments: [{ ...segment, start: 5, end: 4 }] })],
    ['a negative start', batch({ segments: [{ ...segment, start: -1 }] })],
    ['a non-finite end', batch({ segments: [{ ...segment, end: Infinity }] })],
    ['a zero rate', batch({ segments: [{ ...segment, rate: 0 }] })],
    ['an absurd rate', batch({ segments: [{ ...segment, rate: 100 }] })],
    ['captions that are not text', batch({ segments: [{ ...segment, captions: 5 }] })],
    ['a very long captions label', batch({ segments: [{ ...segment, captions: 'x'.repeat(200) }] })],
    ['a visible flag that is not boolean', batch({ segments: [{ ...segment, visible: 'yes' }] })],
    ['a negative position', batch({ position: -3 })],
  ])('rejects %s', (_label, body) => {
    expect(parseWatchBatch(body)).toBeNull()
  })

  it('accepts exactly the most segments allowed', () => {
    expect(parseWatchBatch(batch({ segments: Array(MAX_SEGMENTS_PER_BATCH).fill(segment) }))?.segments).toHaveLength(MAX_SEGMENTS_PER_BATCH)
  })
})

describe('resumeSeconds', () => {
  it('resumes a real position and ignores a trivial or missing one', () => {
    expect(resumeSeconds(95)).toBe(95)
    expect(resumeSeconds(10)).toBe(10)
    expect(resumeSeconds(9.9)).toBe(0)
    expect(resumeSeconds(0)).toBe(0)
    expect(resumeSeconds(null)).toBe(0)
    expect(resumeSeconds(undefined)).toBe(0)
  })
})
