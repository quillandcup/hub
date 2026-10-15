/**
 * Wall clock and pauses for server code that waits or keeps a time budget
 * (rate-limit pauses, "stop before maxDuration" deadlines).
 *
 * Tests swap in a fake with setClock() (see tests/helpers/fake-clock.ts), so
 * a pause costs no real time and a deadline can be reached by moving the clock
 * forward. That's why this exists instead of vi.useFakeTimers(): faking the
 * global timers also fires the HTTP client's own timeouts on in-flight
 * Supabase requests.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let current: Clock = systemClock;

export const clock: Clock = {
  now: () => current.now(),
  sleep: (ms) => current.sleep(ms),
};

export function setClock(next: Clock): void {
  current = next;
}

export function resetClock(): void {
  current = systemClock;
}
