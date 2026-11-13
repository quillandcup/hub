import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadWholeMeetings } from "@/lib/processing/attendance";
import { zoomAttendee } from "@/tests/helpers/zoom-fixtures";

// The attendance run reads Zoom through the repository, so a meeting the repository leaves out makes no
// prickle, no attendance and no member match: the run deletes what it built from it (see
// tests/api/reprocessability/zoom-account-decisions.test.ts for the database half).
describe("what the attendance run reads of an excluded Zoom account", () => {
  const range = { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" };

  async function world() {
    const dataset = new InMemoryDataset();
    const repos = createInMemoryRepos(dataset);
    const second = await repos.zoom.createAccount({ slug: "secondary", label: "Secondary", hostEmail: null, defaultPolicy: "exclude", credentialsPrefix: "ZOOM_SECONDARY" });
    dataset.zoomAttendees.push(
      zoomAttendee({ name: "Ada Example", meeting_uuid: "community-uuid", meeting_id: "1" }),
      zoomAttendee({ name: "Cy Example", meeting_uuid: "personal-uuid", meeting_id: "2", zoom_account: second.id })
    );
    return { repos, second };
  }

  it("reads only the primary account's meetings until the other is kept", async () => {
    const { repos } = await world();

    const { attendees } = await loadWholeMeetings(repos.zoom, range);

    expect(attendees.map((a) => a.name)).toEqual(["Ada Example"]);
  });

  it("reads the other account's meeting once it is kept, and stops again when it is ignored", async () => {
    const { repos, second } = await world();

    await repos.zoom.setDecision({ zoomAccount: second.id, scope: "instance", zoomKey: "personal-uuid", decision: "kept", decidedBy: null });
    expect((await loadWholeMeetings(repos.zoom, range)).attendees.map((a) => a.name).sort()).toEqual(["Ada Example", "Cy Example"]);

    await repos.zoom.setDecision({ zoomAccount: second.id, scope: "instance", zoomKey: "personal-uuid", decision: "ignored", decidedBy: null });
    expect((await loadWholeMeetings(repos.zoom, range)).attendees.map((a) => a.name)).toEqual(["Ada Example"]);
  });

  it("reads nothing at all when every meeting in the range is excluded", async () => {
    const { repos, second } = await world();
    await repos.zoom.setDecision({ zoomAccount: second.id, scope: "series", zoomKey: "1", decision: "ignored", decidedBy: null });
    const primary = (await repos.zoom.accounts()).find((a) => a.slug === "primary")!;
    await repos.zoom.setDecision({ zoomAccount: primary.id, scope: "series", zoomKey: "1", decision: "ignored", decidedBy: null });

    expect((await loadWholeMeetings(repos.zoom, range)).attendees).toEqual([]);
  });
});
