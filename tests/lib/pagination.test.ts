import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageBounds,
  parsePageParam,
  parsePageSizeParam,
  parseSortParams,
} from '@/lib/pagination'

describe('parsePageParam', () => {
  it('reads positive integers and falls back to 1', () => {
    expect(parsePageParam('3')).toBe(3)
    expect(parsePageParam(['4', '9'])).toBe(4)
    expect(parsePageParam(undefined)).toBe(1)
    expect(parsePageParam('0')).toBe(1)
    expect(parsePageParam('-2')).toBe(1)
    expect(parsePageParam('abc')).toBe(1)
  })
})

describe('parsePageSizeParam', () => {
  it('defaults, and caps at MAX_PAGE_SIZE to stay far below the 1000-row limit', () => {
    expect(parsePageSizeParam(undefined)).toBe(DEFAULT_PAGE_SIZE)
    expect(parsePageSizeParam('25')).toBe(25)
    expect(parsePageSizeParam('5000')).toBe(MAX_PAGE_SIZE)
    expect(parsePageSizeParam('nope', 10)).toBe(10)
  })
})

describe('pageBounds', () => {
  it('computes offset and the 1-based item range', () => {
    expect(pageBounds(2, 50, 134)).toEqual({ page: 2, pageSize: 50, pageCount: 3, offset: 50, firstItem: 51, lastItem: 100 })
    expect(pageBounds(3, 50, 134)).toMatchObject({ offset: 100, firstItem: 101, lastItem: 134 })
  })

  it('clamps pages past either end', () => {
    expect(pageBounds(99, 50, 134).page).toBe(3)
    expect(pageBounds(0, 50, 134).page).toBe(1)
  })

  it('handles an empty result', () => {
    expect(pageBounds(1, 50, 0)).toEqual({ page: 1, pageSize: 50, pageCount: 1, offset: 0, firstItem: 0, lastItem: 0 })
  })
})

describe('parseSortParams', () => {
  const allowed = ['name', 'total'] as const
  const fallback = { column: 'name' as const, direction: 'asc' as const }

  it('accepts whitelisted columns and a direction', () => {
    expect(parseSortParams('total', 'desc', allowed, fallback)).toEqual({ column: 'total', direction: 'desc' })
    expect(parseSortParams('total', undefined, allowed, fallback)).toEqual({ column: 'total', direction: 'asc' })
  })

  it('falls back for missing or unknown columns', () => {
    expect(parseSortParams(undefined, 'desc', allowed, fallback)).toBe(fallback)
    expect(parseSortParams('password', 'desc', allowed, null)).toBeNull()
  })
})
