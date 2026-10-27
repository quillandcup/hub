import { describe, it, expect, vi } from "vitest";
import { computeUnmatchedZoomNames } from "@/lib/unmatched-zoom-names";
import { loadIgnoredAppearances } from "@/lib/ignored-zoom-appearances";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const attendee = (name: string, meeting: string, join: string, leave: string) => ({
  name,
  email: null,
  meeting_uuid: meeting,
  join_time: join,
  leave_time: leave,
});

const AUG3 = { start: "2026-08-03T11:00:00Z", end: "2026-08-03T12:00:00Z" };
const AUG4 = { start: "2026-08-04T11:00:00Z", end: "2026-08-04T12:00:00Z" };
const records = [
  attendee("iPhone", "m1", "2026-08-03T11:05:00Z", "2026-08-03T11:30:00Z"),
  attendee("iPhone", "m2", "2026-08-04T11:05:00Z", "2026-08-04T11:30:00Z"),
  attendee("Zed Guest", "m1", "2026-08-03T11:10:00Z", "2026-08-03T11:40:00Z"),
];
const ignoreOn = (zoomName: string, w: { start: string; end: string }) => ({ zoomName, startTime: w.start, endTime: w.end });

describe("computeUnmatchedZoomNames with per-prickle ignores", () => {
  it("counts every appearance when nothing is ignored per prickle", () => {
    const result = computeUnmatchedZoomNames(records, [], [], []);
    expect(result.find((r) => r.zoomName === "iPhone")?.appearances).toBe(2);
  });

  it("drops only the appearances inside the ignored prickle's window", () => {
    const result = computeUnmatchedZoomNames(records, [], [], [], [], [ignoreOn("iPhone", AUG3)]);
    expect(result.find((r) => r.zoomName === "iPhone")?.appearances).toBe(1);
    expect(result.map((r) => r.zoomName)).toContain("Zed Guest");
  });

  it("drops the name once every prickle it appeared on is ignored", () => {
    const result = computeUnmatchedZoomNames(records, [], [], [], [], [ignoreOn("iPhone", AUG3), ignoreOn("iPhone", AUG4)]);
    expect(result.map((r) => r.zoomName)).toEqual(["Zed Guest"]);
  });

  it("leaves other names in the ignored window alone, and records without times", () => {
    const noTimes = [{ name: "iPhone", email: null, meeting_uuid: "m9" }];
    const result = computeUnmatchedZoomNames([...records, ...noTimes], [], [], [], [], [ignoreOn("iPhone", AUG3), ignoreOn("iPhone", AUG4)]);
    expect(result.find((r) => r.zoomName === "iPhone")?.appearances).toBe(1);
    expect(result.map((r) => r.zoomName)).toContain("Zed Guest");
  });
});

describe("loadIgnoredAppearances", () => {
  const PRICKLE = { id: "prkl_AAAAAAAAAAA1", typeId: null, hostId: null, title: null, source: "zoom", calendarEventId: null, startTime: AUG3.start, endTime: AUG3.end };
  repos = createInMemoryRepos(new InMemoryDataset({ prickles: [PRICKLE] as never }));

  const clientWith = (result: { data: unknown; error: { message: string } | null }) =>
    ({ from: () => ({ select: async () => result }) }) as never;

  it("returns nothing without touching prickles when none are ignored", async () => {
    expect(await loadIgnoredAppearances(clientWith({ data: [], error: null }))).toEqual([]);
  });

  it("attaches each ignored name to its prickle's window and skips a prickle that is gone", async () => {
    const result = await loadIgnoredAppearances(
      clientWith({
        data: [
          { zoom_name: "iPhone", prickle_id: PRICKLE.id },
          { zoom_name: "Ghost", prickle_id: "prkl_BBBBBBBBBBB2" },
        ],
        error: null,
      })
    );
    expect(result).toEqual([{ zoomName: "iPhone", startTime: AUG3.start, endTime: AUG3.end }]);
  });

  it("throws when the query fails", async () => {
    await expect(loadIgnoredAppearances(clientWith({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
