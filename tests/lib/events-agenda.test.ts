import { describe, it, expect } from 'vitest'
import {
  agendaMonths,
  agendaWeeks,
  cleanEventTitle,
  formatTimeSpan,
  isAllDay,
  monthOf,
  monthsWithItems,
  parseAgendaMonth,
  pastAgendaWeeks,
  weekStart,
  type AgendaItem,
} from '@/lib/events-agenda'

const item = (key: string, startDate: string, endDate = startDate, startsAt: string | null = null): AgendaItem => ({
  key, href: `/${key}`, title: key, startDate, endDate, time: '', place: null, startsAt, track: 't',
})

describe('agendaMonths', () => {
  it('is this month and the next two, across a year end', () => {
    const months = agendaMonths('2026-11-15')
    expect(months.map((m) => [m.id, m.label, m.first, m.last])).toEqual([
      ['2026-11', 'November', '2026-11-01', '2026-11-30'],
      ['2026-12', 'December', '2026-12-01', '2026-12-31'],
      ['2027-01', 'January', '2027-01-01', '2027-01-31'],
    ])
  })

  it('knows a leap February', () => {
    expect(agendaMonths('2028-01-31')[1].last).toBe('2028-02-29')
  })
})

describe('parseAgendaMonth', () => {
  const months = agendaMonths('2026-10-28')
  it('takes a month on offer, the first value of a repeated param, and else the first month', () => {
    expect(parseAgendaMonth('2026-12', months)).toBe('2026-12')
    expect(parseAgendaMonth(['2026-11', '2026-12'], months)).toBe('2026-11')
    for (const bad of [undefined, null, '', '2027-05', 'bogus', '__proto__']) expect(parseAgendaMonth(bad, months)).toBe('2026-10')
  })
})

describe('weekStart', () => {
  it('is the Sunday on or before', () => {
    expect(weekStart('2026-11-01')).toBe('2026-11-01') // a Sunday
    expect(weekStart('2026-11-04')).toBe('2026-11-01')
    expect(weekStart('2026-11-07')).toBe('2026-11-01')
    expect(weekStart('2026-03-01')).toBe('2026-03-01')
    expect(weekStart('2026-01-01')).toBe('2025-12-28') // across a year
  })
})

describe('formatTimeSpan', () => {
  const NY = 'America/New_York'
  it('writes the time the way the flyer does, in the viewer\'s zone', () => {
    expect(formatTimeSpan('2026-11-03T19:00:00Z', null, NY)).toBe('2 pm EST')
    expect(formatTimeSpan('2026-11-03T19:00:00Z', '2026-11-03T20:00:00Z', NY)).toBe('2 – 3 pm EST')
    expect(formatTimeSpan('2026-11-03T16:30:00Z', '2026-11-03T18:00:00Z', NY)).toBe('11:30 am – 1 pm EST')
  })

  it('follows daylight saving', () => {
    expect(formatTimeSpan('2026-03-07T19:00:00Z', null, NY)).toBe('2 pm EST') // the day before it starts
    expect(formatTimeSpan('2026-03-08T18:00:00Z', null, NY)).toBe('2 pm EDT')
  })

  it('gives only the start of an event that runs past its day, and nothing for all day or no time', () => {
    expect(formatTimeSpan('2026-11-06T22:00:00Z', '2026-11-08T19:00:00Z', NY)).toBe('5 pm EST')
    expect(formatTimeSpan('2026-11-06T05:00:00Z', '2026-11-07T05:00:00Z', NY)).toBe('')
    expect(formatTimeSpan(null, null, NY)).toBe('')
    expect(formatTimeSpan(undefined, undefined, NY)).toBe('')
  })
})

describe('isAllDay', () => {
  it('is midnight to midnight in the organization\'s zone', () => {
    expect(isAllDay('2026-11-06T05:00:00Z', '2026-11-07T05:00:00Z')).toBe(true)
    expect(isAllDay('2026-11-06T05:00:00Z', '2026-11-09T05:00:00Z')).toBe(true)
    expect(isAllDay('2026-11-06T14:00:00Z', '2026-11-06T15:00:00Z')).toBe(false)
    expect(isAllDay('2026-11-06T05:00:00Z', '2026-11-06T15:00:00Z')).toBe(false)
  })
})

describe('cleanEventTitle', () => {
  it('takes off the organization label, category and Prickle label', () => {
    expect(cleanEventTitle('Quill & Cup [Authorpreneurship] Prickle: A Way to Make Money')).toBe('A Way to Make Money')
    expect(cleanEventTitle('Quill & Cup [Challenge] Readers’ Club')).toBe('Readers’ Club')
    expect(cleanEventTitle('Q&C: Pitch Prickle')).toBe('Pitch Prickle')
    expect(cleanEventTitle('[Education] Self-publishing 101')).toBe('Self-publishing 101')
  })

  it('leaves other titles alone, even with "with" or the label inside', () => {
    expect(cleanEventTitle('Writing with Intention')).toBe('Writing with Intention')
    expect(cleanEventTitle('Quill & Cup Challenge')).toBe('Quill & Cup Challenge')
    expect(cleanEventTitle('Our Quill & Cup Retreat')).toBe('Our Quill & Cup Retreat')
  })
})

describe('agendaWeeks', () => {
  const [, october] = agendaMonths('2026-09-26')
  const days = (weeks: ReturnType<typeof agendaWeeks>) => weeks.map((w) => w.days.map((d) => `${d.date}:${d.items.map((i) => i.key).join('+')}`))

  it('groups by day and week, soonest first, a timed item before a later one on the same day', () => {
    const weeks = agendaWeeks(
      [item('late', '2026-10-06', '2026-10-06', '2026-10-06T22:00:00+00:00'), item('early', '2026-10-06', '2026-10-06', '2026-10-06T14:00:00Z'), item('next', '2026-10-13'), item('first', '2026-10-01')],
      october,
      '2026-09-26',
    )
    expect(days(weeks)).toEqual([['2026-10-01:first'], ['2026-10-06:early+late'], ['2026-10-13:next']])
    expect(weeks.map((w) => w.start)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11'])
  })

  it('drops what is outside the month or already over', () => {
    const weeks = agendaWeeks([item('sept', '2026-09-30'), item('nov', '2026-11-01'), item('ok', '2026-10-31')], october, '2026-09-26')
    expect(days(weeks)).toEqual([['2026-10-31:ok']])
    expect(agendaWeeks([item('over', '2026-10-01', '2026-10-02')], october, '2026-10-03')).toEqual([])
  })

  it('puts an item already under way on the first day left: the 1st of next month, or today', () => {
    const retreat = item('retreat', '2026-09-28', '2026-10-03')
    expect(days(agendaWeeks([retreat], october, '2026-09-26'))).toEqual([['2026-10-01:retreat']])
    expect(days(agendaWeeks([retreat], agendaMonths('2026-10-02')[0], '2026-10-02'))).toEqual([['2026-10-02:retreat']])
  })
})

describe('monthOf', () => {
  it('names the month a date is in, with its first and last day', () => {
    expect(monthOf('2028-02-10')).toEqual({ id: '2028-02', label: 'February', first: '2028-02-01', last: '2028-02-29' })
  })
})

describe('monthsWithItems', () => {
  it('lists the months that have an item starting in them, newest first, with counts', () => {
    const months = monthsWithItems([item('a', '2025-03-02'), item('b', '2025-03-20'), item('c', '2024-12-31'), item('d', '2026-01-05', '2026-02-02')])
    expect(months.map((m) => [m.id, m.count])).toEqual([['2026-01', 1], ['2025-03', 2], ['2024-12', 1]])
  })

  it('is empty without items', () => {
    expect(monthsWithItems([])).toEqual([])
  })
})

describe('pastAgendaWeeks', () => {
  it('lists the items that started in the month, even one that ran into the next, and not one that began earlier', () => {
    const month = monthOf('2025-03-15')
    const weeks = pastAgendaWeeks([item('early', '2025-02-27', '2025-03-02'), item('in', '2025-03-10'), item('across', '2025-03-30', '2025-04-02'), item('later', '2025-04-05')], month)
    expect(weeks.flatMap((w) => w.days.flatMap((d) => d.items.map((i) => i.key)))).toEqual(['in', 'across'])
  })
})
