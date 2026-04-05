import { describe, it, expect, beforeAll } from 'vitest'
import { getTestSupabaseClient } from './helpers/supabase'

describe('normalize_name function', () => {
  const supabase = getTestSupabaseClient()

  async function normalizeName(name: string | null): Promise<string | null> {
    const { data, error } = await supabase.rpc('normalize_name', { name })
    if (error) throw error
    return data
  }

  describe('basic normalization', () => {
    it('should lowercase names', async () => {
      expect(await normalizeName('Sarah Johnson')).toBe('sarah johnson')
      expect(await normalizeName('SARAH JOHNSON')).toBe('sarah johnson')
      expect(await normalizeName('SaRaH JoHnSoN')).toBe('sarah johnson')
    })

    it('should trim whitespace', async () => {
      expect(await normalizeName('  Sarah Johnson  ')).toBe('sarah johnson')
      expect(await normalizeName('\t\nSarah Johnson\n\t')).toBe('sarah johnson')
    })

    it('should collapse multiple spaces', async () => {
      expect(await normalizeName('Sarah  Johnson')).toBe('sarah johnson')
      expect(await normalizeName('Sarah   Johnson')).toBe('sarah johnson')
      expect(await normalizeName('Sarah\t\tJohnson')).toBe('sarah johnson')
    })

    it('should remove common punctuation', async () => {
      expect(await normalizeName("O'Brien")).toBe('obrien')
      expect(await normalizeName('Mary-Jane')).toBe('maryjane')
      expect(await normalizeName('Dr. Sarah Johnson')).toBe('dr sarah johnson')
      expect(await normalizeName('Sarah Johnson, PhD')).toBe('sarah johnson phd')
    })
  })

  describe('edge cases', () => {
    it('should handle null input', async () => {
      expect(await normalizeName(null)).toBeNull()
    })

    it('should handle empty string', async () => {
      expect(await normalizeName('')).toBe('')
    })

    it('should handle single character', async () => {
      expect(await normalizeName('A')).toBe('a')
    })

    it('should handle names with numbers', async () => {
      expect(await normalizeName('Sarah Johnson 3rd')).toBe('sarah johnson 3rd')
    })

    it('should handle unicode characters', async () => {
      expect(await normalizeName('José García')).toBe('josé garcía')
      expect(await normalizeName('Müller')).toBe('müller')
    })

    it('should handle special characters', async () => {
      expect(await normalizeName('Sarah (Johnson)')).toBe('sarah (johnson)')
      expect(await normalizeName('Sarah & John')).toBe('sarah & john')
    })
  })

  describe('consistency', () => {
    it('should produce same result for equivalent names', async () => {
      const variations = [
        'Sarah Johnson',
        'SARAH JOHNSON',
        'sarah johnson',
        '  Sarah   Johnson  ',
        'Sarah  Johnson',
      ]

      const normalized = await Promise.all(variations.map(v => normalizeName(v)))
      const expected = 'sarah johnson'

      normalized.forEach(result => {
        expect(result).toBe(expected)
      })
    })

    it('should be idempotent', async () => {
      const name = 'Sarah Johnson'
      const first = await normalizeName(name)
      const second = await normalizeName(first!)

      expect(first).toBe(second)
    })
  })
})
