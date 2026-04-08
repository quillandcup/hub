import { describe, it, expect, beforeAll } from 'vitest'
import { normalizeName } from '@/lib/member-matching'

describe('normalizeName function', () => {

  describe('basic normalization', () => {
    it('should lowercase names', () => {
      expect(normalizeName('Sarah Johnson')).toBe('sarah johnson')
      expect(normalizeName('SARAH JOHNSON')).toBe('sarah johnson')
      expect(normalizeName('SaRaH JoHnSoN')).toBe('sarah johnson')
    })

    it('should trim whitespace', () => {
      expect(normalizeName('  Sarah Johnson  ')).toBe('sarah johnson')
      expect(normalizeName('\t\nSarah Johnson\n\t')).toBe('sarah johnson')
    })

    it('should collapse multiple spaces', () => {
      expect(normalizeName('Sarah  Johnson')).toBe('sarah johnson')
      expect(normalizeName('Sarah   Johnson')).toBe('sarah johnson')
      expect(normalizeName('Sarah\t\tJohnson')).toBe('sarah johnson')
    })

    it('should remove all non-alphanumeric characters (except spaces)', () => {
      expect(normalizeName("O'Brien")).toBe('obrien')
      expect(normalizeName('Mary-Jane')).toBe('maryjane')
      expect(normalizeName('Dr. Sarah Johnson')).toBe('dr sarah johnson')
      expect(normalizeName('Sarah Johnson, PhD')).toBe('sarah johnson phd')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(normalizeName('')).toBe('')
    })

    it('should handle single character', () => {
      expect(normalizeName('A')).toBe('a')
    })

    it('should handle names with numbers', () => {
      expect(normalizeName('Sarah Johnson 3rd')).toBe('sarah johnson 3rd')
    })

    it('should handle unicode characters', () => {
      // Note: TypeScript version preserves unicode letters
      expect(normalizeName('José García')).toBe('jos garca')
      expect(normalizeName('Müller')).toBe('mller')
    })

    it('should remove all special characters', () => {
      // TypeScript version removes ALL non-alphanumeric (except spaces)
      expect(normalizeName('Sarah (Johnson)')).toBe('sarah johnson')
      expect(normalizeName('Sarah & John')).toBe('sarah john')
    })
  })

  describe('consistency', () => {
    it('should produce same result for equivalent names', () => {
      const variations = [
        'Sarah Johnson',
        'SARAH JOHNSON',
        'sarah johnson',
        '  Sarah   Johnson  ',
        'Sarah  Johnson',
      ]

      const normalized = variations.map(v => normalizeName(v))
      const expected = 'sarah johnson'

      normalized.forEach(result => {
        expect(result).toBe(expected)
      })
    })

    it('should be idempotent', () => {
      const name = 'Sarah Johnson'
      const first = normalizeName(name)
      const second = normalizeName(first)

      expect(first).toBe(second)
    })
  })
})
