import { describe, it, expect } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { groupByCalendarEntry, loadMissingHosts } from "@/lib/missing-hosts";

const type = (id: string, name: string, requiresHost: boolean, defaultHostId: string | null = null) => ({
  id, name, normalizedName: name.toLowerCase(), purpose: "writing", requiresHost, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false, defaultHostId,
});
const prickle = (id: string, typeId: string | null, hostId: string | null, source = "calendar") => ({
  id, typeId, hostId, title: null, source, calendarEventId: null, startTime: "2026-10-19T15:00:00Z", endTime: "2026-10-19T16:00:00Z",
});
const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", displayName: "Fernie", email: "fern@example.test" };

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

  it("includes the host coverage and every member, with their status, to pick from", async () => {
    const { coverage, members } = await loadMissingHosts(repos);

    expect(coverage).toMatchObject({ total: 9, requiresHost: { withHost: 1, withoutHost: 3 }, optionalHost: { withHost: 1, withoutHost: 3 } });
    expect(members.map((m) => [m.name, m.status])).toEqual([["Ada Example", "active"], ["Fern Example", "active"], ["Gale Example", "cancelled"]]);
  });

  it("gives the picker each member's display name, so searching it finds them", async () => {
    const { members } = await loadMissingHosts(repos);

    expect(members.map((m) => [m.name, m.displayName])).toEqual([["Ada Example", null], ["Fern Example", "Fernie"], ["Gale Example", null]]);
  });

  it("names a default host by display name", async () => {
    const withDisplayHost = createInMemoryRepos(
      new InMemoryDataset({
        members: [FERN],
        prickleTypes: [type("t1", "Sprint", true, FERN.id)],
        prickles: [prickle("p1", "t1", null)],
      }),
    );

    const { stats } = await loadMissingHosts(withDisplayHost);

    expect(stats[0]).toMatchObject({ defaultHostName: "Fernie" });
  });
});

describe("groupByCalendarEntry", () => {
  const detail = (id: string, calendarEventId: string | null, startTime: string, typeName = "Sprint", normalizedName = typeName.toLowerCase()) =>
    ({
      id, typeId: "t1", hostId: null, title: null, source: "calendar", calendarEventId, startTime, endTime: startTime,
      type: { ...type("t1", typeName, true), normalizedName }, host: null,
    }) as unknown as Parameters<typeof groupByCalendarEntry>[0][number];
  const event = (id: string, summary: string | null, creator = "Ada Example", description: string | null = null) => ({ id, summary, description, creator_name: creator });

  it("groups prickles by the calendar entry's title, ignoring case and spacing, and counts them", () => {
    const groups = groupByCalendarEntry(
      [detail("p3", "e3", "2026-11-03T23:00:00Z"), detail("p2", "e2", "2026-10-27T23:00:00Z"), detail("p1", "e1", "2026-10-20T23:00:00Z")],
      [event("e1", "Prickle w/AJ", "Ada Example", "Hosted by AJ"), event("e2", " prickle w/aj "), event("e3", "Prickle w/AJ", "Fern Example")],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ summary: "Prickle w/AJ", count: 3, newestStart: "2026-11-03T23:00:00Z", oldestStart: "2026-10-20T23:00:00Z", creators: ["Ada Example", "Fern Example"] });
    expect(groups[0].prickles.map((p) => p.id)).toEqual(["p3", "p2", "p1"]);
  });

  it("lists the biggest groups first, caps the links, keeps prickles without an entry and skips events", () => {
    const many = Array.from({ length: 7 }, (_, i) => detail(`m${i}`, "e1", `2026-10-${20 + i}T23:00:00Z`));
    const groups = groupByCalendarEntry(
      [detail("x", "e2", "2026-10-01T00:00:00Z", "Chat"), detail("y", "e3", "2026-10-01T00:00:00Z", "Event"), detail("z", null, "2026-10-01T00:00:00Z"), ...many],
      [event("e1", "Sprint with Ada"), event("e2", "Chat time"), event("e3", "Party")],
    );

    expect(groups.map((g) => g.summary)).toEqual(["Sprint with Ada", "", "Chat time"]);
    expect(groups[0].count).toBe(7);
    expect(groups[0].prickles).toHaveLength(5);
    expect(groups.some((g) => g.summary === "Party")).toBe(false);
  });
});
