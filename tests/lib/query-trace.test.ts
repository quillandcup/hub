import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFakeClock } from "../helpers/fake-clock";

const setTag = vi.fn();
const setContext = vi.fn();
const logWarn = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  getIsolationScope: () => ({ setTag, setContext }),
  logger: { warn: (...a: unknown[]) => logWarn(...a) },
}));

const sendOperationsAlert = vi.fn(async () => {});
const service = {};
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: (...a: unknown[]) => sendOperationsAlert(...(a as [])) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => service }));

import { DbQueryError, SLOW_SECTION_MS, throwIfDbError, traced } from "@/lib/query-trace";



beforeEach(() => {
  setTag.mockReset();
  setContext.mockReset();
  logWarn.mockReset();
  sendOperationsAlert.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("throwIfDbError", () => {
  it("does nothing without an error", () => {
    expect(() => throwIfDbError("x", null)).not.toThrow();
  });

  it("turns a Supabase error object into an Error naming the section, flagging a statement timeout", () => {
    const timeout = { code: "57014", message: "canceling statement due to statement timeout" };
    try {
      throwIfDbError("activity feed: count_activity_feed", timeout);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DbQueryError);
      expect((e as DbQueryError).name).toBe("DbStatementTimeout");
      expect((e as DbQueryError).message).toContain("activity feed: count_activity_feed");
      expect((e as DbQueryError).message).toContain("57014");
      expect((e as DbQueryError).cause).toBe(timeout);
    }
  });

  it("keeps other errors as DbQueryError", () => {
    expect(() => throwIfDbError("s", { code: "42501", message: "denied" })).toThrow(/s: denied \(42501\)/);
  });
});

describe("traced", () => {
  const fake = useFakeClock();

  it("returns the result without noise when fast", async () => {
    await expect(traced("fast", async () => 7)).resolves.toBe(7);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("logs a slow section that succeeded", async () => {
    await traced("slow", async () => fake.clock.advance(SLOW_SECTION_MS + 1), { memberId: "mbr_AAAAAAAAAAA1" });
    expect(logWarn).toHaveBeenCalledWith("Slow section slow", { section: "slow", ms: SLOW_SECTION_MS + 1, memberId: "mbr_AAAAAAAAAAA1" });
  });

  it("tags the request's Sentry scope and rethrows the same error when it fails", async () => {
    const error = new Error("nope");
    await expect(
      traced(
        "broken",
        async () => {
          fake.clock.advance(50);
          throw error;
        },
        { memberId: "mbr_AAAAAAAAAAA1" }
      )
    ).rejects.toBe(error);
    expect(sendOperationsAlert).toHaveBeenCalledWith(service, { type: "section_failed", section: "broken", code: undefined, ms: 50 });
    expect(setTag).toHaveBeenCalledWith("section", "broken");
    expect(setContext).toHaveBeenCalledWith("section", { name: "broken", ms: 50, memberId: "mbr_AAAAAAAAAAA1" });
  });

  it("alerts with the Postgres code, so a statement timeout reads as one", async () => {
    await expect(traced("slowdb", async () => { throw new DbQueryError("slowdb", { code: "57014", message: "t" }); })).rejects.toBeInstanceOf(DbQueryError);
    expect(sendOperationsAlert).toHaveBeenCalledWith(service, expect.objectContaining({ section: "slowdb", code: "57014" }));
  });

  it("alerts for a thrown value that is not an object", async () => {
    await expect(traced("odd", async () => { throw null; })).rejects.toBeNull();
    expect(sendOperationsAlert).toHaveBeenCalledWith(service, expect.objectContaining({ section: "odd", code: undefined }));
  });
});
