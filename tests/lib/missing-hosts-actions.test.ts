import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let admin = true;
let dbError: string | null = null;
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (admin ? { ok: true, supabase: {} } : { ok: false, error: "Forbidden" }),
}));
const reprocess = vi.hoisted(() => vi.fn(async () => ({ processed: [{ table: "calendar", success: true }] as { table: string; success: boolean; error?: string }[] })));
vi.mock("@/lib/processing/trigger", () => ({ triggerPrickleTypeReprocessing: reprocess }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
let repos = createInMemoryRepos();
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => {
    if (dbError) repos.prickles.updateType = async () => Promise.reject(new Error(dbError!));
    return repos;
  },
}));

import { getUnhostedPrickles, setDefaultHosts, setRequiresHost } from "@/app/(admin)/admin/data-health/missing-hosts/actions";

const SPRINT = { id: "t1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const prickle = (id: string, start: string, hostId: string | null = null) => ({
  id, typeId: SPRINT.id, hostId, title: null, source: "calendar", calendarEventId: null, startTime: start, endTime: start,
});

beforeEach(() => {
  admin = true;
  dbError = null;
  vi.clearAllMocks();
  dataset = new InMemoryDataset({
    members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }],
    prickleTypes: [SPRINT, { ...SPRINT, id: "t2", name: "Chat", normalizedName: "chat", defaultHostId: "mbr_AAAAAAAAAAA1" }],
    prickles: [prickle("p1", "2026-10-01T15:00:00Z"), prickle("p2", "2026-10-08T15:00:00Z"), prickle("p3", "2026-10-15T15:00:00Z", "mbr_AAAAAAAAAAA1")],
  });
  repos = createInMemoryRepos(dataset);
});

describe("missing hosts actions", () => {
  it("lists a type's unhosted prickles, newest first", async () => {
    const result = await getUnhostedPrickles(SPRINT.id);

    expect(result).toEqual({
      prickles: [
        { id: "p2", title: null, startTime: "2026-10-08T15:00:00Z", endTime: "2026-10-08T15:00:00Z", typeName: "Sprint" },
        { id: "p1", title: null, startTime: "2026-10-01T15:00:00Z", endTime: "2026-10-01T15:00:00Z", typeName: "Sprint" },
      ],
    });
  });

  it("refuses non-admins", async () => {
    admin = false;

    expect(await getUnhostedPrickles(SPRINT.id)).toEqual({ error: "Forbidden" });
    expect(await setRequiresHost(SPRINT.id, false)).toEqual({ error: "Forbidden" });
    expect(await setDefaultHosts([{ typeId: SPRINT.id, memberId: null }])).toEqual({ error: "Forbidden" });
    expect(dataset.prickleTypes[0].requiresHost).toBe(true);
  });

  it("flips whether a type needs a host, then refreshes the page", async () => {
    expect(await setRequiresHost(SPRINT.id, false)).toEqual({});

    expect(dataset.prickleTypes[0].requiresHost).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/data-health/missing-hosts");
  });

  it("reports a failed flip without refreshing the page", async () => {
    dbError = "boom";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await setRequiresHost(SPRINT.id, false)).toEqual({ error: "boom" });

    expect(revalidatePath).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("saves several default hosts, rebuilds the calendar prickles once, and refreshes the page", async () => {
    const result = await setDefaultHosts([
      { typeId: "t1", memberId: "mbr_AAAAAAAAAAA1" },
      { typeId: "t2", memberId: null },
    ]);

    expect(result).toEqual({ saved: 2 });
    expect(dataset.prickleTypes.map((t) => [t.id, t.defaultHostId ?? null])).toEqual([
      ["t1", "mbr_AAAAAAAAAAA1"],
      ["t2", null],
    ]);
    expect(reprocess).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/data-health/missing-hosts");
  });

  it("does nothing for no choices, and rejects an id that isn't a member's", async () => {
    expect(await setDefaultHosts([])).toEqual({ saved: 0 });
    expect(await setDefaultHosts([{ typeId: "t1", memberId: "not-a-member" }])).toEqual({ error: "Pick a member" });
    expect(dataset.prickleTypes.find((t) => t.id === "t2")?.defaultHostId).toBe("mbr_AAAAAAAAAAA1");
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("reports a failed save without rebuilding", async () => {
    dbError = "boom";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await setDefaultHosts([{ typeId: "t1", memberId: "mbr_AAAAAAAAAAA1" }])).toEqual({ error: "boom" });
    expect(reprocess).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("says so when the choices saved but the rebuild failed", async () => {
    reprocess.mockResolvedValueOnce({ processed: [{ table: "calendar", success: false, error: "timeout" }] });

    expect(await setDefaultHosts([{ typeId: "t1", memberId: "mbr_AAAAAAAAAAA1" }])).toEqual({
      error: "Saved, but rebuilding the calendar prickles failed: timeout",
      saved: 1,
    });
  });
});
