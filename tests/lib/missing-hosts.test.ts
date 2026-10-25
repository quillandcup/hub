import { describe, it, expect } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadMissingHosts } from "@/lib/missing-hosts";

const type = (id: string, name: string, requiresHost: boolean, defaultHostId: string | null = null) => ({
  id, name, normalizedName: name.toLowerCase(), purpose: "writing", requiresHost, soloTaskFriendly: false, defaultHostId,
});
const prickle = (id: string, typeId: string | null, hostId: string | null, source = "calendar") => ({
  id, typeId, hostId, title: null, source, calendarEventId: null, startTime: "2026-10-19T15:00:00Z", endTime: "2026-10-19T16:00:00Z",
});
const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test" };

describe("loadMissingHosts", () => {
  const repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [ADA, FERN, { id: "mbr_AAAAAAAAAAA3", name: "Gale Example", email: "gale@example.test", status: "cancelled" }],
      prickleTypes: [type("t1", "Sprint", true, ADA.id), type("t2", "Chat", false), type("t3", "Workshop", true), type("t4", "Solo", false)],
      prickles: [
        prickle("p1", "t1", null), prickle("p2", "t1", null), prickle("p3", "t1", FERN.id), // Sprint: 2 unhosted, 1 hosted
        prickle("p4", "t2", null), prickle("p5", "t2", null), prickle("p6", "t2", null), // Chat: 3 unhosted
        prickle("p7", "t3", null), // Workshop: 1 unhosted
        prickle("p8", "t4", FERN.id), // Solo: all hosted, so absent
        prickle("p9", "t1", null, "zoom"), prickle("p10", null, null), // not counted: other source, no type
      ],
    }),
  );

  it("lists the types with unhosted calendar prickles, those that need a host first and then by count", async () => {
    const { stats } = await loadMissingHosts(repos);

    expect(stats.map((s) => [s.typeName, s.requiresHost, s.missingCount])).toEqual([
      ["Sprint", true, 2],
      ["Workshop", true, 1],
      ["Chat", false, 3],
    ]);
  });

  it("names each type's default host", async () => {
    const { stats } = await loadMissingHosts(repos);

    expect(stats.find((s) => s.typeName === "Sprint")).toMatchObject({ defaultHostId: ADA.id, defaultHostName: "Ada Example" });
    expect(stats.find((s) => s.typeName === "Workshop")).toMatchObject({ defaultHostId: null, defaultHostName: null });
  });

  it("includes the host coverage and the active members to pick from", async () => {
    const { coverage, members } = await loadMissingHosts(repos);

    expect(coverage).toMatchObject({ total: 9, requiresHost: { withHost: 1, withoutHost: 3 }, optionalHost: { withHost: 1, withoutHost: 3 } });
    expect(members.map((m) => m.name)).toEqual(["Ada Example", "Fern Example"]); // not the cancelled one
  });
});
