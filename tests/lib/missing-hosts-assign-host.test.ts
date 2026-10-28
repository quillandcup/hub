import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// "Assign to all" on the missing-hosts page: credit one member (a former one included) as the host of
// every unhosted calendar prickle of a type, keeping the choice the way "Change host" does.

const TYPE = { id: "ptyp_AAAAAAAAAAA1", name: "Social Media Sunday", normalizedName: "social media sunday", purpose: "social", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const FORMER = { id: "mbr_AAAAAAAAAAA1", name: "Ann Example", email: "ann@example.test", status: "cancelled" };
const prickle = (n: number, hostId: string | null = null, calendarEventId: string | null = `cal-${n}`) => ({
  id: `prkl_AAAAAAAAAAA${n}`, typeId: TYPE.id, hostId, title: null, source: "calendar", calendarEventId,
  startTime: `2026-01-0${n}T15:00:00Z`, endTime: `2026-01-0${n}T16:00:00Z`,
});

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let admin = true;
let decisions: Record<string, unknown>[];
let failInsertFor: string | null;
const supabase = {
  from: () => ({
    select: () => ({ eq: async (_c: string, id: string) => ({ data: decisions.filter((d) => d.calendar_event_id === id).map((d) => ({ id: d.calendar_event_id })), error: null }) }),
    update: (row: Record<string, unknown>) => ({
      eq: async (_c: string, id: string) => {
        const existing = decisions.find((d) => d.calendar_event_id === id);
        if (existing) Object.assign(existing, row);
        return { error: null };
      },
    }),
    insert: async (row: Record<string, unknown>) => {
      if (row.calendar_event_id === failInsertFor) return { error: { message: "nope" } };
      decisions.push(row);
      return { error: null };
    },
  }),
};
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (admin ? { ok: true, supabase, user: { id: "u1" } } : { ok: false, error: "Not authorized" }),
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("@/lib/processing/trigger", () => ({ triggerPrickleTypeReprocessing: vi.fn() }));

import { assignHostToUnhostedPrickles } from "@/app/(admin)/admin/data-health/missing-hosts/actions";

beforeEach(() => {
  admin = true;
  failInsertFor = null;
  decisions = [];
  vi.clearAllMocks();
  repos = createInMemoryRepos(
    new InMemoryDataset({
      // The Bronze calendar items the prickles follow, whose summaries a decision records.
      calendarEvents: ["cal-1", "cal-2", "cal-3"].map((id) => ({
        id, google_event_id: `g-${id}`, summary: `Event ${id}`, description: null, location: null, raw_data: {},
        start_time: "2097-03-03T15:00:00Z", end_time: "2097-03-03T16:00:00Z",
        creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null,
      })),
      members: [FORMER, { id: "mbr_AAAAAAAAAAA2", name: "Bea Example" }],
      prickleTypes: [TYPE],
      prickles: [prickle(1), prickle(2), prickle(3, "mbr_AAAAAAAAAAA2")],
    }),
  );
});

describe("assignHostToUnhostedPrickles", () => {
  it("credits a former member as the host of every unhosted prickle, and records each event's decision so a reprocess keeps it", async () => {
    const result = await assignHostToUnhostedPrickles(TYPE.id, FORMER.id);

    expect(result).toEqual({ assigned: 2 });
    expect((await repos.prickles.byId("prkl_AAAAAAAAAAA1"))?.hostId).toBe(FORMER.id);
    expect((await repos.prickles.byId("prkl_AAAAAAAAAAA2"))?.hostId).toBe(FORMER.id);
    // A prickle that already had a host is left alone.
    expect((await repos.prickles.byId("prkl_AAAAAAAAAAA3"))?.hostId).toBe("mbr_AAAAAAAAAAA2");
    expect(decisions.map((d) => [d.calendar_event_id, d.resolved_host_id, d.status]).sort()).toEqual([
      ["cal-1", FORMER.id, "resolved"],
      ["cal-2", FORMER.id, "resolved"],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/data-health/missing-hosts");
  });

  it("updates an event's existing decision instead of adding a second", async () => {
    decisions.push({ calendar_event_id: "cal-1", status: "pending" });

    await assignHostToUnhostedPrickles(TYPE.id, FORMER.id);

    expect(decisions.filter((d) => d.calendar_event_id === "cal-1")).toEqual([expect.objectContaining({ status: "resolved", resolved_host_id: FORMER.id })]);
  });

  it("assigns nothing when no prickle is unhosted", async () => {
    await assignHostToUnhostedPrickles(TYPE.id, FORMER.id);

    expect(await assignHostToUnhostedPrickles(TYPE.id, FORMER.id)).toEqual({ assigned: 0 });
  });

  it("refuses non-admins, ids that aren't a member's, and members that don't exist, without writing", async () => {
    admin = false;
    expect(await assignHostToUnhostedPrickles(TYPE.id, FORMER.id)).toEqual({ error: "Not authorized" });
    admin = true;
    expect(await assignHostToUnhostedPrickles(TYPE.id, "not-a-member")).toEqual({ error: "Pick a member" });
    expect(await assignHostToUnhostedPrickles(TYPE.id, "mbr_ZZZZZZZZZZZZ")).toEqual({ error: "Member not found" });

    expect(decisions).toEqual([]);
    expect((await repos.prickles.byId("prkl_AAAAAAAAAAA1"))?.hostId ?? null).toBeNull();
  });

  it("stops and says how far it got when a decision can't be saved", async () => {
    failInsertFor = "cal-2";

    const result = await assignHostToUnhostedPrickles(TYPE.id, FORMER.id);

    expect(result).toMatchObject({ error: expect.stringContaining("Couldn't save the change"), assigned: 1 });
    expect((result as { error: string }).error).toContain("Assigned 1 before it stopped");
  });
});
