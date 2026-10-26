import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";

// Regression test for a bug where prickles scheduled in the future (already synced from the
// calendar, but not yet occurred) were counted as "hosted" -- inflating totals, counting as
// no-shows, and letting "most recent hosted" show a future date. getMyHostingStats must scope
// the prickles query to start_time <= now.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Prickles and attendance go through their repositories (lib/data/); this test has none of its own, so
// it gets the in-memory twins over a dataset each test fills.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => {
  const { createInMemoryRepos } = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { createRepos: () => createInMemoryRepos(dataset) };
});

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

const WRITING = { id: "pt1", name: "Progress Prickle", normalizedName: "progress", purpose: "writing", requiresHost: false, soloTaskFriendly: false, isSpecialty: false };
const prickle = (id: string, hostId: string | null, startTime: string) => ({
  id,
  typeId: WRITING.id,
  hostId,
  title: null,
  startTime,
  endTime: new Date(new Date(startTime).getTime() + 3_600_000).toISOString(),
  source: "calendar",
  calendarEventId: null,
});

function makeSupabaseMock() {
  const from = vi.fn();
  return { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) }, from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMyHostingStats", () => {
  it("counts only the acting member's prickles that have already started", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    dataset = new InMemoryDataset({
      prickleTypes: [WRITING],
      prickles: [
        prickle("p1", "member-1", "2020-01-01T10:00:00.000Z"),
        prickle("p2", "member-1", future), // synced from the calendar, not yet happened
        prickle("p3", "someone-else", "2020-01-02T10:00:00.000Z"),
      ],
    });
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const stats = await getMyHostingStats();

    expect(stats.totalHosted).toBe(1);
    expect(stats.mostRecentHostedAt).toBe("2020-01-01T10:00:00.000Z");
  });

  it("returns empty stats without querying prickles when there is no member record", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    const stats = await getMyHostingStats();

    expect(stats.totalHosted).toBe(0);
    expect(mock.from).not.toHaveBeenCalledWith("prickles");
  });
});
