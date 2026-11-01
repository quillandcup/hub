import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

// The join settings live in the zoom repository, in memory here.
let repos: Repos;
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { removeScheduledPrickleJoin, savePrickleJoin } from "@/app/(admin)/admin/prickle-join/actions";

const URL_OK = "https://zoom.example.test/j/123?pwd=abc";

const setting = (id: string) => ({
  id,
  join_url: URL_OK,
  meeting_id: null,
  passcode: null,
  effective_from: "2099-01-05T05:00:00.000Z",
  created_at: "2026-10-01T00:00:00.000Z",
  created_by: null,
});

function signInAdmin(seed = new InMemoryDataset()) {
  dataset = seed;
  repos = createInMemoryRepos(dataset);
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "admin-user" }, supabase: {} });
}

/** The one setting saved so far, as stored. */
const saved = async () => (await repos.zoom.joinSettings())[0];

beforeEach(() => {
  vi.clearAllMocks();
  signInAdmin();
});

describe("savePrickleJoin", () => {
  it("starts now when no day is given, and trims the inputs", async () => {
    const before = Date.now();
    expect(await savePrickleJoin({ url: ` ${URL_OK} `, meetingId: " 880 7170 2629 ", passcode: " thriving " })).toEqual({ success: true });

    const row = await saved();
    expect(row).toMatchObject({ join_url: URL_OK, meeting_id: "880 7170 2629", passcode: "thriving" });
    expect(dataset.joinSettings[0].created_by).toBe("admin-user");
    expect(Date.parse(row.effective_from)).toBeGreaterThanOrEqual(before);
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/prickle-join");
  });

  it("schedules a future day from its midnight in the org timezone, and allows no passcode", async () => {
    await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "", startDate: "2099-01-05" });

    // Midnight Eastern in January is 05:00Z.
    expect(await saved()).toMatchObject({ meeting_id: null, passcode: null, effective_from: "2099-01-05T05:00:00.000Z" });
  });

  it("refuses a non-admin before touching anything", async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: "Not authorized" });

    expect(await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "x" })).toEqual({ error: "Not authorized" });
    expect(await repos.zoom.joinSettings()).toHaveLength(0);
  });

  it.each(["", "not a url", "http://zoom.example.test/j/1"])("rejects the link %j", async (url) => {
    expect(await savePrickleJoin({ url, meetingId: "", passcode: "x" })).toEqual({ error: "Enter the full https:// join link" });
    expect(await repos.zoom.joinSettings()).toHaveLength(0);
  });

  it.each(["2000-01-01", "nope"])("rejects the start day %j", async (startDate) => {
    expect(await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "x", startDate })).toEqual({
      error: "Pick a start day after today, or leave it blank to start now",
    });
    expect(await repos.zoom.joinSettings()).toHaveLength(0);
  });

  it("reports a failed save without revalidating", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repos.zoom.addJoinSetting = async () => {
      throw new Error("boom");
    };

    expect(await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "x" })).toEqual({ error: "Couldn't save the join link" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("removeScheduledPrickleJoin", () => {
  it("removes a scheduled setting", async () => {
    signInAdmin(new InMemoryDataset({ joinSettings: [setting("s1")] }));

    expect(await removeScheduledPrickleJoin("s1")).toEqual({ success: true });
    expect(await repos.zoom.joinSettings()).toHaveLength(0);
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/prickle-join");
  });

  it("says so when the setting already took effect (nothing deleted)", async () => {
    expect(await removeScheduledPrickleJoin("s1")).toEqual({ error: "That change already took effect, so it can't be removed" });
  });

  it("refuses a non-admin, a bad id and a database error", async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: "Not authorized" });
    expect(await removeScheduledPrickleJoin("s1")).toEqual({ error: "Not authorized" });

    signInAdmin();
    expect(await removeScheduledPrickleJoin("")).toEqual({ error: "Invalid setting" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    repos.zoom.removeJoinSetting = async () => {
      throw new Error("boom");
    };
    expect(await removeScheduledPrickleJoin("s1")).toEqual({ error: "Couldn't remove it" });
  });
});
