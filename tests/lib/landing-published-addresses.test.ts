/**
 * The proxy's list of published page addresses (src/lib/landing/published-addresses.ts): one cached read, never a read per
 * request, and a failing or slow database only ever means "no page here".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FRESH_MS, READ_TIMEOUT_MS, RETRY_MS, forgetPublishedAddresses, isPublishedAddress } from "@/lib/landing/published-addresses";
import { useFakeClock } from "@/tests/helpers/fake-clock";

describe("isPublishedAddress", () => {
  const fake = useFakeClock();
  beforeEach(() => forgetPublishedAddresses());

  it("answers from one read, however many questions follow, including made-up addresses", async () => {
    const read = vi.fn(async () => ["spring", "home"]);
    expect(await isPublishedAddress("spring", read)).toBe(true);
    expect(await isPublishedAddress("home", read)).toBe(true);
    for (let i = 0; i < 50; i++) expect(await isPublishedAddress(`made-up-${i}`, read)).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shares one read between requests that arrive together", async () => {
    const read = vi.fn(async () => ["spring"]);
    const answers = await Promise.all([isPublishedAddress("spring", read), isPublishedAddress("other", read), isPublishedAddress("spring", read)]);
    expect(answers).toEqual([true, false, true]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again after it goes stale, so a page published or taken down shows within the freshness window", async () => {
    let slugs = ["spring"];
    const read = vi.fn(async () => slugs);
    expect(await isPublishedAddress("summer", read)).toBe(false);
    slugs = ["spring", "summer"];
    fake.clock.advance(FRESH_MS - 1);
    expect(await isPublishedAddress("summer", read)).toBe(false);
    fake.clock.advance(1);
    expect(await isPublishedAddress("summer", read)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("says no page when the read fails, and does not try again until RETRY_MS has passed", async () => {
    const read = vi.fn(async (): Promise<string[]> => {
      throw new Error("database down");
    });
    expect(await isPublishedAddress("spring", read)).toBe(false);
    expect(await isPublishedAddress("spring", read)).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    fake.clock.advance(RETRY_MS);
    expect(await isPublishedAddress("spring", read)).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the last list when a later read fails, rather than dropping every page", async () => {
    const good = vi.fn(async () => ["spring"]);
    expect(await isPublishedAddress("spring", good)).toBe(true);
    fake.clock.advance(FRESH_MS);
    const bad = vi.fn(async (): Promise<string[]> => {
      throw new Error("database down");
    });
    expect(await isPublishedAddress("spring", bad)).toBe(true);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("gives up on a read that stalls, after the timeout, and counts it as no page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const stalled = () => new Promise<string[]>(() => {});
      const answer = isPublishedAddress("spring", stalled);
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
      expect(await answer).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a lookup that throws before it returns a promise (no service key) as no page", async () => {
    const read = () => {
      throw new Error("supabaseKey is required");
    };
    expect(await isPublishedAddress("spring", read as unknown as () => Promise<string[]>)).toBe(false);
  });
});
