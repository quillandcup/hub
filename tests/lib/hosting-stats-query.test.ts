import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for a bug where prickles scheduled in the future (already synced from the
// calendar, but not yet occurred) were counted as "hosted" -- inflating totals, counting as
// no-shows, and letting "most recent hosted" show a future date. getMyHostingStats must scope
// the prickles query to start_time <= now.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

import { getMyHostingStats } from "@/app/(member)/hosting/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = {
  memberId: "member-1",
  memberName: "Member One",
  memberEmail: "m1@example.com",
  isSudo: false,
};

function makeSupabaseMock(prickleRows: { id: string; start_time: string; prickle_types: { name: string } | null }[]) {
  const prickleEqSpy = vi.fn();
  const prickleLteSpy = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === "prickles") {
      const obj: any = {};
      obj.select = vi.fn(() => obj);
      obj.eq = vi.fn((...args: unknown[]) => {
        prickleEqSpy(...args);
        return obj;
      });
      obj.lte = vi.fn((...args: unknown[]) => {
        prickleLteSpy(...args);
        return obj;
      });
      obj.range = vi.fn(() => Promise.resolve({ data: prickleRows }));
      return obj;
    }
    if (table === "prickle_attendance") {
      const obj: any = {};
      obj.select = vi.fn(() => obj);
      obj.eq = vi.fn(() => obj);
      obj.in = vi.fn(() => obj);
      obj.range = vi.fn(() => Promise.resolve({ data: [] }));
      return obj;
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-user-1" } } }) },
    from,
    __prickleEqSpy: prickleEqSpy,
    __prickleLteSpy: prickleLteSpy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMyHostingStats", () => {
  it("scopes the prickles query to the acting member and to start_time <= now", async () => {
    const past = {
      id: "p1",
      start_time: "2020-01-01T10:00:00.000Z",
      prickle_types: { name: "Progress Prickle" },
    };
    const mock = makeSupabaseMock([past]);
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const stats = await getMyHostingStats();

    expect(mock.__prickleEqSpy).toHaveBeenCalledWith("host", "member-1");
    expect(mock.__prickleLteSpy).toHaveBeenCalledWith("start_time", expect.any(String));

    const lteArg = mock.__prickleLteSpy.mock.calls[0][1] as string;
    expect(new Date(lteArg).getTime()).not.toBeNaN();
    expect(new Date(lteArg).getTime()).toBeLessThanOrEqual(Date.now());

    expect(stats.totalHosted).toBe(1);
    expect(stats.mostRecentHostedAt).toBe("2020-01-01T10:00:00.000Z");
  });

  it("returns empty stats without querying prickles when there is no member record", async () => {
    const mock = makeSupabaseMock([]);
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    const stats = await getMyHostingStats();

    expect(stats.totalHosted).toBe(0);
    expect(mock.from).not.toHaveBeenCalledWith("prickles");
  });
});
