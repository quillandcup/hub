import { afterEach, beforeEach } from 'vitest'
import { setClock, resetClock, type Clock } from '@/lib/clock'

/**
 * A virtual clock for code that uses lib/clock. sleep() moves time forward
 * and resolves right away, so pauses cost nothing; advance() jumps ahead to
 * reach a deadline. Only lib/clock is affected: Date, setTimeout and the HTTP
 * client's timers stay real, so in-flight Supabase requests aren't disturbed.
 */
export class FakeClock implements Clock {
  /** Total virtual time slept, to assert that code paused. */
  slept = 0

  constructor(private time: number) {}

  now(): number {
    return this.time
  }

  async sleep(ms: number): Promise<void> {
    this.time += ms
    this.slept += ms
  }

  advance(ms: number): void {
    this.time += ms
  }
}

/**
 * Gives each test in the file a fresh FakeClock starting at `start`
 * (default: the real time when the test starts), and restores the system
 * clock afterwards. Read it through the returned object: `fake.clock`.
 */
export function useFakeClock(start?: () => number): { clock: FakeClock } {
  const holder = {} as { clock: FakeClock }
  beforeEach(() => {
    holder.clock = new FakeClock(start ? start() : Date.now())
    setClock(holder.clock)
  })
  afterEach(() => resetClock())
  return holder
}
