import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let admin = true;
const update = vi.fn();
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () =>
    admin
      ? { ok: true, supabase: { from: () => ({ update: (patch: unknown) => ({ eq: (...args: unknown[]) => (update(patch, ...args), Promise.resolve({ error: null })) }) }) } }
      : { ok: false, error: "Forbidden" },
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { getUnhostedPrickles, setDefaultHost, setRequiresHost } from "@/app/(admin)/admin/data-health/missing-hosts/actions";

const SPRINT = { id: "t1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, isSpecialty: false };
const prickle = (id: string, start: string, hostId: string | null = null) => ({
  id, typeId: SPRINT.id, hostId, title: null, source: "calendar", calendarEventId: null, startTime: start, endTime: start,
});

beforeEach(() => {
  admin = true;
  vi.clearAllMocks();
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }],
      prickleTypes: [SPRINT],
      prickles: [prickle("p1", "2026-10-01T15:00:00Z"), prickle("p2", "2026-10-08T15:00:00Z"), prickle("p3", "2026-10-15T15:00:00Z", "mbr_AAAAAAAAAAA1")],
    }),
  );
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
    expect(await setDefaultHost(SPRINT.id, null)).toEqual({ error: "Forbidden" });
    expect(update).not.toHaveBeenCalled();
  });

  it("flips whether a type needs a host, and sets or clears its default host, then refreshes the page", async () => {
    expect(await setRequiresHost(SPRINT.id, false)).toEqual({});
    expect(await setDefaultHost(SPRINT.id, "mbr_AAAAAAAAAAA1")).toEqual({});
    expect(await setDefaultHost(SPRINT.id, null)).toEqual({});

    expect(update.mock.calls.map((c) => c[0])).toEqual([{ requires_host: false }, { default_host_id: "mbr_AAAAAAAAAAA1" }, { default_host_id: null }]);
    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/data-health/missing-hosts");
  });
});
