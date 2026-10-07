import { describe, it, expect } from 'vitest'
import { splitIntoWindows } from '@/lib/processing/date-windows'

const iso = (windows: { from: Date; to: Date }[]) => windows.map((w) => [w.from.toISOString(), w.to.toISOString()])

describe('splitIntoWindows', () => {
  it('covers the range with consecutive windows that neither overlap nor leave a gap', () => {
    const windows = splitIntoWindows(new Date('2026-07-08T00:00:00.000Z'), new Date('2026-07-25T23:59:59.000Z'), 7)
    expect(iso(windows)).toEqual([
      ['2026-07-08T00:00:00.000Z', '2026-07-14T23:59:59.999Z'],
      ['2026-07-15T00:00:00.000Z', '2026-07-21T23:59:59.999Z'],
      ['2026-07-22T00:00:00.000Z', '2026-07-25T23:59:59.000Z'],
    ])
  })

  it('returns one window for a range shorter than the window', () => {
    const from = new Date('2026-07-08T00:00:00.000Z')
    const to = new Date('2026-07-09T12:00:00.000Z')
    expect(splitIntoWindows(from, to, 7)).toEqual([{ from, to }])
  })

  it('splits 90 days into 13 weekly windows', () => {
    const windows = splitIntoWindows(new Date('2026-07-08T00:00:00.000Z'), new Date('2026-10-05T23:59:59.000Z'), 7)
    expect(windows).toHaveLength(13)
    expect(windows[0].from.toISOString()).toBe('2026-07-08T00:00:00.000Z')
    expect(windows[12].to.toISOString()).toBe('2026-10-05T23:59:59.000Z')
  })

  it('handles a single instant and an inverted range without looping', () => {
    const at = new Date('2026-07-08T00:00:00.000Z')
    expect(splitIntoWindows(at, at, 7)).toEqual([{ from: at, to: at }])
    const earlier = new Date('2026-07-01T00:00:00.000Z')
    expect(splitIntoWindows(at, earlier, 7)).toEqual([{ from: at, to: earlier }])
  })
})
