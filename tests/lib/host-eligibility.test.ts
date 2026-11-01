import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Members come from their repository; this test gives the function in-memory ones.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

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
  function useMembers(rows: { id: string; firstJoinedAt: string | null; mostRecentJoinedAt: string | null }[]) {
    repos = createInMemoryRepos(
      new InMemoryDataset({ members: rows.map((r) => ({ ...r, name: r.id, email: `${r.id}@example.test` })) }),
    );
    return vi.spyOn(repos.members, "byIds");
  }
  const client = {} as Parameters<typeof fetchHostEligibilityByMember>[0];

  it("returns an empty map without reading members when there are no ids", async () => {
    const byIds = useMembers([]);
    expect((await fetchHostEligibilityByMember(client, [], at("2026-09-26"))).size).toBe(0);
    expect(byIds).not.toHaveBeenCalled();
  });

  it("computes eligibility per member from their first join, reading each member once", async () => {
    const byIds = useMembers([
      { id: "new", firstJoinedAt: "2026-09-10", mostRecentJoinedAt: "2026-09-10" },
      { id: "veteran", firstJoinedAt: "2021-01-01", mostRecentJoinedAt: "2021-01-01" },
      { id: "rejoiner", firstJoinedAt: "2021-01-01", mostRecentJoinedAt: "2026-09-20" },
      { id: "unknown", firstJoinedAt: null, mostRecentJoinedAt: null },
    ]);

    const result = await fetchHostEligibilityByMember(client, ["new", "veteran", "rejoiner", "unknown", "new"], at("2026-09-26"));

    expect(result.get("new")).toEqual({ eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" });
    expect(result.get("veteran")?.eligible).toBe(true);
    expect(result.get("rejoiner")?.eligible).toBe(true);
    expect(result.get("unknown")).toEqual({ eligible: false, tenureStartDate: null, eligibleOn: null });
    expect(byIds).toHaveBeenCalledTimes(1);
    expect(byIds).toHaveBeenCalledWith(["new", "veteran", "rejoiner", "unknown"]); // de-duplicated
  });

  it("throws when the members read fails", async () => {
    useMembers([]);
    vi.spyOn(repos.members, "byIds").mockRejectedValue(new Error("boom"));
    await expect(fetchHostEligibilityByMember(client, ["x"], at("2026-09-26"))).rejects.toThrow("boom");
  });
});
