import { describe, it, expect } from 'vitest'
import { normalizePrickleType, parsePrickleFromSummary } from '@/lib/prickle-types'

// ---------------------------------------------------------------------------
// normalizePrickleType
// ---------------------------------------------------------------------------

describe('normalizePrickleType', () => {
  it('lowercases and hyphenates a plain type name', () => {
    expect(normalizePrickleType('HEADS DOWN')).toBe('heads-down')
  })

  it('strips a trailing "Prickle" suffix', () => {
    expect(normalizePrickleType('Heads Down Prickle')).toBe('heads-down')
  })

  it('strips a trailing "prickle" regardless of case', () => {
    expect(normalizePrickleType('Sprint PRICKLE')).toBe('sprint')
  })

  it('strips a leading "Prickle" prefix', () => {
    expect(normalizePrickleType('Prickle Sprint')).toBe('sprint')
  })

  it('collapses a bare "Prickle" to an empty string', () => {
    expect(normalizePrickleType('  Prickle  ')).toBe('')
  })

  it('removes special characters other than hyphens', () => {
    expect(normalizePrickleType("Open Table Prickle!")).toBe('open-table')
  })

  it('collapses multiple internal spaces into a single hyphen', () => {
    expect(normalizePrickleType('Open   Table')).toBe('open-table')
  })

  // Regression test for GitHub CodeQL alert #3 (js/polynomial-redos):
  // the old `/\s*prickle\s*/gi` pattern could take quadratic time on long
  // runs of whitespace with no "prickle" present, since the engine retried
  // the same `\s*` backtrack at every offset within the run. A long
  // space-only (or otherwise "prickle"-free) string is exactly the
  // adversarial input that pattern was flagged for.
  it('handles a very long run of spaces without hanging (ReDoS regression)', () => {
    const pathological = ' '.repeat(50000)
    const start = Date.now()
    const result = normalizePrickleType(pathological)
    const elapsed = Date.now() - start

    expect(result).toBe('')
    expect(elapsed).toBeLessThan(1000)
  })

  it('handles a long whitespace run that does contain "prickle" (ReDoS regression)', () => {
    const pathological = ' '.repeat(50000) + 'prickle' + ' '.repeat(50000)
    const start = Date.now()
    const result = normalizePrickleType(pathological)
    const elapsed = Date.now() - start

    expect(result).toBe('')
    expect(elapsed).toBeLessThan(1000)
  })
})

// ---------------------------------------------------------------------------
// parsePrickleFromSummary
// ---------------------------------------------------------------------------

describe('parsePrickleFromSummary', () => {
  it('parses a plain "Prickle w/Host" summary as a Progress Prickle', () => {
    expect(parsePrickleFromSummary('Prickle w/Lili')).toEqual({
      type: 'Prickle',
      host: 'Lili',
    })
  })

  it('parses a typed prickle with a host', () => {
    expect(parsePrickleFromSummary('HEADS DOWN w/Cody')).toEqual({
      type: 'HEADS DOWN',
      host: 'Cody',
    })
  })

  it('parses a standalone prickle type with no host', () => {
    expect(parsePrickleFromSummary('Open Table Prickle')).toEqual({
      type: 'Open Table Prickle',
      host: null,
    })
  })

  it('strips surrounding quotes from a custom type name', () => {
    expect(parsePrickleFromSummary("'Midnight Crew' w/member13-display")).toEqual({
      type: 'Midnight Crew',
      host: 'member13-display',
    })
  })
})
