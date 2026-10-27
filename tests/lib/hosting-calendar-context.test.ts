import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase } from "@/tests/helpers/server-page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { getHostingCalendarContext } from "@/app/(member)/hosting/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const prickle = (id: string, typeId: string | null, hostId: string | null, start: string) => ({
  id,
  typeId,
  hostId,
  title: null,
  startTime: start,
  endTime: new Date(new Date(start).getTime() + 3_600_000).toISOString(),
  source: "calendar",
  calendarEventId: null,
});

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue(createFakeSupabase({ prickle_schedules: { data: [] } }) as never);
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "a@example.test" });
});

describe("getHostingCalendarContext", () => {
  it("lists the month's prickles with host and type names, nothing from the days after it", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }],
        prickleTypes: [SPRINT],
        prickles: [
          prickle("prkl_AAAAAAAAAAA1", SPRINT.id, "mbr_AAAAAAAAAAA1", "2097-03-05T15:00:00Z"),
          prickle("prkl_AAAAAAAAAAA2", null, null, "2097-03-06T15:00:00Z"),
          prickle("prkl_AAAAAAAAAAA3", SPRINT.id, null, "2097-02-27T15:00:00Z"),
          prickle("prkl_AAAAAAAAAAA4", SPRINT.id, null, "2097-04-02T15:00:00Z"),
        ],
      }),
    );

    const context = await getHostingCalendarContext("2097-03-01");

    expect(context.prickles.map((p) => [p.id, p.host, p.prickle_type])).toEqual([
      ["prkl_AAAAAAAAAAA1", "Ada Example", "Sprint"],
      ["prkl_AAAAAAAAAAA2", "", "Prickle"],
    ]);
    expect(context.proposedSlots).toEqual([]);
  });

  it("is empty when nobody is signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    expect(await getHostingCalendarContext("2097-03-01")).toEqual({ prickles: [], proposedSlots: [] });
  });
});
