import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (auth.admin ? { ok: true, user: { id: "user-admin", email: "admin@example.test" }, supabase: {} } : { ok: false, error: "Not authorized" }),
}));
const data = vi.hoisted(() => ({ current: null as null | unknown }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => data.current,
}));
const outcomes = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("@/lib/analytics/server", () => ({
  withAction: async (name: string, run: () => Promise<unknown>) => {
    outcomes.names.push(name);
    return run();
  },
}));
const trigger = vi.hoisted(() => ({ reprocess: vi.fn(async (_range: { from: Date; to: Date }) => ({ success: true })) }));
vi.mock("@/lib/processing/trigger", () => ({ triggerAttendanceReprocessing: trigger.reprocess }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { decideZoomMeetings } from "@/app/(admin)/admin/hygiene/zoom-meetings/actions";

let repos: ReturnType<typeof createInMemoryRepos>;
let secondId: string;

const meeting = (uuid: string, id: string, day: number) => ({
  zoom_account: secondId,
  meeting_uuid: uuid,
  meeting_id: id,
  topic: `Topic ${id}`,
  start_time: `2026-10-0${day}T13:00:00Z`,
  end_time: `2026-10-0${day}T14:00:00Z`,
  data: {},
});

beforeEach(async () => {
  auth.admin = true;
  outcomes.names = [];
  trigger.reprocess.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  repos = createInMemoryRepos(new InMemoryDataset());
  data.current = repos;
  secondId = (await repos.zoom.createAccount({ slug: "secondary", label: "Secondary", hostEmail: null, defaultPolicy: "exclude", credentialsPrefix: "ZOOM_SECONDARY" })).id;
  await repos.zoom.upsertMeeting(meeting("uuid-1", "111", 1));
  await repos.zoom.upsertMeeting(meeting("uuid-2", "111", 3));
});

describe("decideZoomMeetings", () => {
  it("keeps the chosen meetings as the admin and rebuilds attendance for the stretch they cover", async () => {
    const result = await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [{ zoomAccount: secondId, zoomKey: "uuid-1" }] });

    expect(result).toEqual({ success: true, decided: 1 });
    expect((await repos.zoom.reviewMeetings()).map((m) => [m.meetingUuid, m.state])).toEqual([["uuid-2", "undecided"], ["uuid-1", "kept"]]);
    expect((await repos.zoom.keepPolicy()).decisions.size).toBe(1);
    expect(trigger.reprocess).toHaveBeenCalledOnce();
    expect(trigger.reprocess.mock.calls[0][0]).toEqual({ from: new Date("2026-10-01T13:00:00Z"), to: new Date("2026-10-01T14:00:00Z") });
    expect(outcomes.names).toEqual(["zoom_meetings_decided"]);
  });

  it("writes one decision for a link, covering all its occurrences, and reprocesses all of them", async () => {
    await decideZoomMeetings({ choice: "ignored", scope: "series", targets: [{ zoomAccount: secondId, zoomKey: "111" }] });

    expect((await repos.zoom.reviewMeetings()).map((m) => m.state)).toEqual(["ignored", "ignored"]);
    expect(trigger.reprocess.mock.calls[0][0]).toEqual({ from: new Date("2026-10-01T13:00:00Z"), to: new Date("2026-10-03T14:00:00Z") });
  });

  it("takes a decision back so the account's default applies again", async () => {
    await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [{ zoomAccount: secondId, zoomKey: "uuid-1" }] });

    await decideZoomMeetings({ choice: "undecided", scope: "instance", targets: [{ zoomAccount: secondId, zoomKey: "uuid-1" }] });

    expect((await repos.zoom.reviewMeetings()).map((m) => m.state)).toEqual(["undecided", "undecided"]);
  });

  it("saves the decision and says so when rebuilding attendance fails", async () => {
    trigger.reprocess.mockRejectedValueOnce(new Error("processing down"));

    const result = await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [{ zoomAccount: secondId, zoomKey: "uuid-1" }] });

    expect(result).toEqual({ success: true, decided: 1, reprocessError: "processing down" });
    expect((await repos.zoom.keepPolicy()).decisions.size).toBe(1);
  });

  it("does not reprocess when the decision covers no imported meeting", async () => {
    const result = await decideZoomMeetings({ choice: "kept", scope: "series", targets: [{ zoomAccount: secondId, zoomKey: "not-imported-yet" }] });

    expect(result).toEqual({ success: true, decided: 1 });
    expect(trigger.reprocess).not.toHaveBeenCalled();
  });

  it("refuses non-admins without writing anything", async () => {
    auth.admin = false;

    expect(await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [{ zoomAccount: secondId, zoomKey: "uuid-1" }] })).toEqual({ error: "Not authorized" });

    expect((await repos.zoom.keepPolicy()).decisions.size).toBe(0);
    expect(outcomes.names).toEqual([]);
  });

  it("refuses a malformed request, an empty or oversized pick and an unknown account", async () => {
    const target = { zoomAccount: secondId, zoomKey: "uuid-1" };

    expect(await decideZoomMeetings({ choice: "maybe" as never, scope: "instance", targets: [target] })).toEqual({ error: "Invalid request" });
    expect(await decideZoomMeetings({ choice: "kept", scope: "galaxy" as never, targets: [target] })).toEqual({ error: "Invalid request" });
    expect(await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [] })).toEqual({ error: "Pick at least one meeting" });
    expect(await decideZoomMeetings({ choice: "kept", scope: "instance", targets: Array.from({ length: 501 }, (_, i) => ({ zoomAccount: secondId, zoomKey: `u${i}` })) })).toEqual({
      error: "Pick at most 500 meetings at a time",
    });
    expect(await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [{ zoomAccount: secondId, zoomKey: "" }] })).toEqual({ error: "Invalid request" });
    expect(await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [{ zoomAccount: "zacc_Nope00000001", zoomKey: "uuid-1" }] })).toEqual({ error: "Unknown Zoom account" });
    expect((await repos.zoom.keepPolicy()).decisions.size).toBe(0);
  });

  it("returns the database's message when a write fails", async () => {
    repos.zoom.setDecision = async () => {
      throw new Error("write failed");
    };

    expect(await decideZoomMeetings({ choice: "kept", scope: "instance", targets: [{ zoomAccount: secondId, zoomKey: "uuid-1" }] })).toEqual({ error: "write failed" });
  });
});
