import { describe, it, expect } from 'vitest'
import { clock, systemClock } from '@/lib/clock'
import { FakeClock, useFakeClock } from '../helpers/fake-clock'

describe('lib/clock', () => {
  it('uses the system clock by default', () => {
    const before = Date.now()
    const now = clock.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
    expect(systemClock.now).toBeTypeOf('function')
  })
})

describe('FakeClock', () => {
  it('sleeps instantly, moving virtual time forward', async () => {
    const fake = new FakeClock(1_000)
    const realStart = Date.now()
    await fake.sleep(60_000)
    expect(fake.now()).toBe(61_000)
    expect(fake.slept).toBe(60_000)
    expect(Date.now() - realStart).toBeLessThan(1_000)
  })

  it('advances without counting as sleep', () => {
    const fake = new FakeClock(0)
    fake.advance(5_000)
    expect(fake.now()).toBe(5_000)
    expect(fake.slept).toBe(0)
  })
})

describe('useFakeClock', () => {
  const fake = useFakeClock(() => 42_000)

  it('routes lib/clock through a fresh fake per test', async () => {
    expect(clock.now()).toBe(42_000)
    await clock.sleep(1_000)
    expect(fake.clock.now()).toBe(43_000)
  })

  it('starts the next test from the start time again', () => {
    expect(clock.now()).toBe(42_000)
    expect(fake.clock.slept).toBe(0)
  })
})
