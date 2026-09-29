import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mirrorLoginEvents } from '@/lib/processing/login-events'

/**
 * A 90-day lookback can return more than PostgREST's 1000-row cap, so the
 * mirror must page through sessions and chunk its "already mirrored?" lookup.
 * The real behavior (auth sessions -> activities) is covered in
 * tests/api/reconcile/login-events.test.ts; this only fakes volume.
 */
function fakeSupabase(sessionCount: number, alreadyMirrored: Set<string>) {
  const sessions = Array.from({ length: sessionCount }, (_, i) => ({
    session_id: `s-${String(i).padStart(5, '0')}`,
    user_id: `u-${i % 10}`,
    email: null,
    created_at: '2026-09-01T00:00:00Z',
  }))
  const members = Array.from({ length: 10 }, (_, i) => ({ id: `m-${i}`, user_id: `u-${i}`, email: null }))
  const inserted: unknown[] = []
  const inLookupSizes: number[] = []

  const page = <T>(rows: T[]) => ({
    order() {
      return this
    },
    range: async (start: number, end: number) => ({ data: rows.slice(start, end + 1), error: null }),
  })

  const client = {
    rpc: () => page(sessions),
    from(table: string) {
      if (table === 'members') return { select: () => page(members) }
      if (table === 'member_email_aliases') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      // member_activities
      return {
        select: () => ({
          eq: () => ({
            in: async (_col: string, ids: string[]) => {
              inLookupSizes.push(ids.length)
              return { data: ids.filter((id) => alreadyMirrored.has(id)).map((related_id) => ({ related_id })), error: null }
            },
          }),
        }),
        insert: async (rows: unknown[]) => {
          inserted.push(...rows)
          return { error: null }
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, inserted, inLookupSizes }
}

describe('mirrorLoginEvents paging', () => {
  it('reads every session past the 1000-row cap and inserts only new ones', async () => {
    const { client, inserted, inLookupSizes } = fakeSupabase(2500, new Set(['s-00000', 's-02499']))

    const result = await mirrorLoginEvents(client, { from: new Date(0), to: new Date() })

    expect(result).toEqual({ sessionsSeen: 2500, activitiesInserted: 2498 })
    expect(inserted).toHaveLength(2498)
    expect(Math.max(...inLookupSizes)).toBeLessThanOrEqual(200)
    expect(inLookupSizes.reduce((a, b) => a + b, 0)).toBe(2500)
  })
})
