import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { removeScheduledPrickleJoin, savePrickleJoin } from "@/app/(admin)/admin/prickle-join/actions";

const URL_OK = "https://zoom.example.test/j/123?pwd=abc";
let supabase: ReturnType<typeof createFakeSupabase>;

function signInAdmin(tables: FakeTables = {}) {
  supabase = createFakeSupabase(tables);
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "admin-user" }, supabase });
}

const insertedRow = () =>
  supabase.queries.flatMap((q) => q.calls).find((c) => c.method === "insert")?.args[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  signInAdmin();
});

describe("savePrickleJoin", () => {
  it("starts now when no day is given, and trims the inputs", async () => {
    const before = Date.now();
    expect(await savePrickleJoin({ url: ` ${URL_OK} `, meetingId: " 880 7170 2629 ", passcode: " thriving " })).toEqual({ success: true });

    const row = insertedRow();
    expect(row).toMatchObject({ join_url: URL_OK, meeting_id: "880 7170 2629", passcode: "thriving", created_by: "admin-user" });
    expect(Date.parse(row.effective_from as string)).toBeGreaterThanOrEqual(before);
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/prickle-join");
  });

  it("schedules a future day from its midnight in the org timezone, and allows no passcode", async () => {
    await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "", startDate: "2099-01-05" });

    // Midnight Eastern in January is 05:00Z.
    expect(insertedRow()).toMatchObject({ meeting_id: null, passcode: null, effective_from: "2099-01-05T05:00:00.000Z" });
  });

  it("refuses a non-admin before touching anything", async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: "Not authorized" });

    expect(await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "x" })).toEqual({ error: "Not authorized" });
    expect(supabase.queries).toHaveLength(0);
  });

  it.each(["", "not a url", "http://zoom.example.test/j/1"])("rejects the link %j", async (url) => {
    expect(await savePrickleJoin({ url, meetingId: "", passcode: "x" })).toEqual({ error: "Enter the full https:// join link" });
    expect(insertedRow()).toBeUndefined();
  });

  it.each(["2000-01-01", "nope"])("rejects the start day %j", async (startDate) => {
    expect(await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "x", startDate })).toEqual({
      error: "Pick a start day after today, or leave it blank to start now",
    });
    expect(insertedRow()).toBeUndefined();
  });

  it("reports a failed save without revalidating", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signInAdmin({ prickle_join_settings: { error: { message: "boom" } } });

    expect(await savePrickleJoin({ url: URL_OK, meetingId: "", passcode: "x" })).toEqual({ error: "Couldn't save the join link" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("removeScheduledPrickleJoin", () => {
  it("removes a scheduled setting", async () => {
    signInAdmin({ prickle_join_settings: { data: [{ id: "s1" }] } });

    expect(await removeScheduledPrickleJoin("s1")).toEqual({ success: true });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/prickle-join");
  });

  it("says so when the setting already took effect (nothing deleted)", async () => {
    signInAdmin({ prickle_join_settings: { data: [] } });

    expect(await removeScheduledPrickleJoin("s1")).toEqual({ error: "That change already took effect, so it can't be removed" });
  });

  it("refuses a non-admin, a bad id and a database error", async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: "Not authorized" });
    expect(await removeScheduledPrickleJoin("s1")).toEqual({ error: "Not authorized" });

    signInAdmin();
    expect(await removeScheduledPrickleJoin("")).toEqual({ error: "Invalid setting" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    signInAdmin({ prickle_join_settings: { error: { message: "boom" } } });
    expect(await removeScheduledPrickleJoin("s1")).toEqual({ error: "Couldn't remove it" });
  });
});
