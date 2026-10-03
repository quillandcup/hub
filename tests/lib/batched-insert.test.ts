import { describe, it, expect } from 'vitest'
import { writeInBatches } from '@/lib/supabase/batched-insert'

const rows = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('writeInBatches', () => {
  it('writes every row in batches, never more than `concurrency` batches at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const written: number[][] = []

    const count = await writeInBatches(
      rows(23),
      async (batch) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        written.push(batch)
        inFlight--
        return { error: null }
      },
      { batchSize: 5, concurrency: 2 }
    )

    expect(count).toBe(23)
    expect(maxInFlight).toBe(2)
    expect(written.map((b) => b.length).sort()).toEqual([3, 5, 5, 5, 5])
    expect(written.flat().sort((a, b) => a - b)).toEqual(rows(23))
  })

  it('throws the first error and starts no further groups', async () => {
    const attempted: number[] = []
    const failure = { message: '520' }

    await expect(
      writeInBatches(
        rows(10),
        async (batch) => {
          attempted.push(batch[0])
          return { error: batch[0] === 2 ? failure : null }
        },
        { batchSize: 2, concurrency: 2 }
      )
    ).rejects.toBe(failure)

    // Groups are [0,2] and [4,6] and [8]; the first group fails, so nothing after it runs.
    expect(attempted).toEqual([0, 2])
  })

  it('does nothing for no rows', async () => {
    let calls = 0
    expect(await writeInBatches([], async () => (calls++, { error: null }))).toBe(0)
    expect(calls).toBe(0)
  })
})
