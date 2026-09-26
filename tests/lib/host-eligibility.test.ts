import { describe, it, expect, vi } from "vitest";
import {
  HOST_ELIGIBILITY_MIN_MONTHS,
  fetchHostEligibilityByMember,
  getHostEligibility,
  hostEligibilityMessage,
  hostEligibleOnDate,
  hostingTenureStartDate,
  isEligibleToHost,
  orgLocalDate,
  type HostEligibilityMember,
} from "@/lib/host-eligibility";

// Noon UTC is the same calendar date in America/New_York, so these read as
// plain org-local dates.
function at(date: string): Date {
  return new Date(`${date}T16:00:00Z`);
}

function member(overrides: Partial<HostEligibilityMember> = {}): HostEligibilityMember {
  return { firstJoinedAt: "2026-01-15", mostRecentJoinedAt: "2026-01-15", ...overrides };
}

describe("HOST_ELIGIBILITY_MIN_MONTHS", () => {
  it("is one full month", () => {
    expect(HOST_ELIGIBILITY_MIN_MONTHS).toBe(1);
  });
});

describe("hostEligibleOnDate", () => {
  it("adds one calendar month", () => {
    expect(hostEligibleOnDate("2026-01-15")).toBe("2026-02-15");
    expect(hostEligibleOnDate("2026-12-10")).toBe("2027-01-10");
  });

  it("clamps to the end of a shorter month", () => {
    expect(hostEligibleOnDate("2026-01-31")).toBe("2026-02-28");
    expect(hostEligibleOnDate("2028-01-31")).toBe("2028-02-29"); // leap year
    expect(hostEligibleOnDate("2026-03-31")).toBe("2026-04-30");
    expect(hostEligibleOnDate("2026-01-30")).toBe("2026-02-28");
  });

  it("accepts a timestamp and uses its date part", () => {
    expect(hostEligibleOnDate("2026-01-15T00:00:00+00:00")).toBe("2026-02-15");
  });
});

describe("isEligibleToHost — one-month boundary", () => {
  it("is not eligible the day before the one-month mark", () => {
    expect(isEligibleToHost(member(), at("2026-02-14"))).toBe(false);
  });

  it("is eligible on exactly the one-month mark", () => {
    expect(isEligibleToHost(member(), at("2026-02-15"))).toBe(true);
  });

  it("is eligible after the one-month mark", () => {
    expect(isEligibleToHost(member(), at("2026-06-01"))).toBe(true);
  });

  it("is not eligible on the join date itself", () => {
    expect(isEligibleToHost(member(), at("2026-01-15"))).toBe(false);
  });

  it("uses the org-local (New York) date, not UTC", () => {
    // 2026-02-15T03:00Z is still Feb 14 in New York.
    expect(orgLocalDate(new Date("2026-02-15T03:00:00Z"))).toBe("2026-02-14");
    expect(isEligibleToHost(member(), new Date("2026-02-15T03:00:00Z"))).toBe(false);
    // 05:00Z is just past midnight Feb 15 in New York (EST, UTC-5).
    expect(isEligibleToHost(member(), new Date("2026-02-15T05:00:00Z"))).toBe(true);
  });
});

describe("isEligibleToHost — month-end clamping", () => {
  const jan31 = member({ firstJoinedAt: "2026-01-31", mostRecentJoinedAt: "2026-01-31" });

  it("a Jan 31 joiner becomes eligible on Feb 28, not in March", () => {
    expect(isEligibleToHost(jan31, at("2026-02-27"))).toBe(false);
    expect(isEligibleToHost(jan31, at("2026-02-28"))).toBe(true);
  });

  it("a Jan 31 joiner in a leap year becomes eligible on Feb 29", () => {
    const leap = member({ firstJoinedAt: "2028-01-31", mostRecentJoinedAt: "2028-01-31" });
    expect(isEligibleToHost(leap, at("2028-02-28"))).toBe(false);
    expect(isEligibleToHost(leap, at("2028-02-29"))).toBe(true);
  });
});

describe("hostingTenureStartDate — counts from first join", () => {
  it("a rejoiner after years away is measured from their first join, so doesn't wait a month", () => {
    const rejoiner = member({ firstJoinedAt: "2020-03-01", mostRecentJoinedAt: "2026-09-20" });
    expect(hostingTenureStartDate(rejoiner)).toBe("2020-03-01");
    expect(getHostEligibility(rejoiner, at("2026-09-26"))).toEqual({
      eligible: true,
      tenureStartDate: "2020-03-01",
      eligibleOn: "2020-04-01",
    });
  });

  it("a member back from hiatus is measured from their first join", () => {
    const returning = member({ firstJoinedAt: "2022-05-01", mostRecentJoinedAt: "2026-09-24" });
    expect(isEligibleToHost(returning, at("2026-09-26"))).toBe(true);
  });

  it("a rejoiner whose first join was under a month ago still waits", () => {
    const quickRejoin = member({ firstJoinedAt: "2026-09-01", mostRecentJoinedAt: "2026-09-20" });
    expect(getHostEligibility(quickRejoin, at("2026-09-26"))).toEqual({
      eligible: false,
      tenureStartDate: "2026-09-01",
      eligibleOn: "2026-10-01",
    });
  });

  it("uses the date part of a timestamp", () => {
    expect(hostingTenureStartDate(member({ firstJoinedAt: "2022-05-01T00:00:00Z" }))).toBe("2022-05-01");
  });
});

describe("getHostEligibility — missing dates", () => {
  it("is not eligible (and has no date) when both join dates are null", () => {
    const m = member({ firstJoinedAt: null, mostRecentJoinedAt: null });
    expect(getHostEligibility(m, at("2026-09-26"))).toEqual({
      eligible: false,
      tenureStartDate: null,
      eligibleOn: null,
    });
  });

  it("uses first_joined_at when most_recent_joined_at is null", () => {
    const m = member({ firstJoinedAt: "2026-01-15", mostRecentJoinedAt: null });
    expect(getHostEligibility(m, at("2026-09-26"))).toEqual({
      eligible: true,
      tenureStartDate: "2026-01-15",
      eligibleOn: "2026-02-15",
    });
  });

  it("falls back to most_recent_joined_at only when first_joined_at is null", () => {
    const m = member({ firstJoinedAt: null, mostRecentJoinedAt: "2026-09-01" });
    expect(getHostEligibility(m, at("2026-09-26"))).toEqual({
      eligible: false,
      tenureStartDate: "2026-09-01",
      eligibleOn: "2026-10-01",
    });
  });
});

describe("hostEligibilityMessage", () => {
  it("names the eligibility date when known", () => {
    expect(hostEligibilityMessage({ eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" })).toBe(
      "We invite hedgies to host once they've been a member for a full month — for you, that's October 10, 2026."
    );
  });

  it("omits the date when the join date is unknown", () => {
    expect(hostEligibilityMessage({ eligible: false, tenureStartDate: null, eligibleOn: null })).toBe(
      "We invite hedgies to host once they've been a member for a full month."
    );
  });
});

describe("fetchHostEligibilityByMember", () => {
  function fakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
    return {
      from: vi.fn((table: string) => ({
        select: () => ({
          in: (column: string, values: string[]) =>
            Promise.resolve({ data: tables[table].filter((r) => values.includes(r[column] as string)), error: null }),
        }),
      })),
    } as unknown as Parameters<typeof fetchHostEligibilityByMember>[0] & { from: ReturnType<typeof vi.fn> };
  }

  it("returns an empty map without querying when there are no ids", async () => {
    const supabase = fakeSupabase({ members: [] });
    expect((await fetchHostEligibilityByMember(supabase, [], at("2026-09-26"))).size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("computes eligibility per member from their first join", async () => {
    const supabase = fakeSupabase({
      members: [
        { id: "new", first_joined_at: "2026-09-10", most_recent_joined_at: "2026-09-10" },
        { id: "veteran", first_joined_at: "2021-01-01", most_recent_joined_at: "2021-01-01" },
        { id: "rejoiner", first_joined_at: "2021-01-01", most_recent_joined_at: "2026-09-20" },
        { id: "unknown", first_joined_at: null, most_recent_joined_at: null },
      ],
    });

    const result = await fetchHostEligibilityByMember(
      supabase,
      ["new", "veteran", "rejoiner", "unknown", "new"],
      at("2026-09-26")
    );

    expect(result.get("new")).toEqual({ eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" });
    expect(result.get("veteran")?.eligible).toBe(true);
    expect(result.get("rejoiner")?.eligible).toBe(true);
    expect(result.get("unknown")).toEqual({ eligible: false, tenureStartDate: null, eligibleOn: null });
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("members");
  });

  it("chunks large id lists", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `m${i}`);
    const supabase = fakeSupabase({
      members: ids.map((id) => ({ id, first_joined_at: "2021-01-01", most_recent_joined_at: "2021-01-01" })),
    });
    const result = await fetchHostEligibilityByMember(supabase, ids, at("2026-09-26"));
    expect(result.size).toBe(250);
    expect(supabase.from).toHaveBeenCalledTimes(3);
  });

  it("throws when a query fails", async () => {
    const supabase = {
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: new Error("boom") }) }) }),
    } as unknown as Parameters<typeof fetchHostEligibilityByMember>[0];
    await expect(fetchHostEligibilityByMember(supabase, ["x"], at("2026-09-26"))).rejects.toThrow("boom");
  });
});
