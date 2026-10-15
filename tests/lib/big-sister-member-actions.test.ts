import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";
const mocks = vi.hoisted(() => ({ user: vi.fn(), identity: vi.fn(), client: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: mocks.identity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveReasonNote, setBigSisterAvailability } from "@/app/(member)/big-sisters/actions";
const identity = { memberId: "mentor", isSudo: false };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.identity.mockResolvedValue(identity);
  mocks.client.mockResolvedValue(createFakeSupabase({ members: { data: { first_joined_at: "2020-01-01", most_recent_joined_at: null } } }));
});
describe("Big Sister member actions", () => {
  it.each([
    ["signed out", null, identity, "Not signed in"],
    ["without a member", { id: "user" }, null, "No member record"],
    ["sudo", { id: "user" }, { ...identity, isSudo: true }, "Viewing as a member is read-only."],
  ])("refuses both writes when %s", async (_name, user, effective, error) => {
    mocks.user.mockResolvedValue(user); mocks.identity.mockResolvedValue(effective);
    expect(await setBigSisterAvailability(true)).toEqual({ error });
    expect(await saveReasonNote("match", "reason")).toEqual({ error });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("restores availability with a trimmed staff note for the caller only", async () => {
    const db = await mocks.client();
    expect(await setBigSisterAvailability(true, "  mornings  ")).toEqual({ success: true });
    expect(db.queries.find((q: { table: string }) => q.table === "big_sister_volunteers")?.calls).toContainEqual({ method: "upsert", args: [{ member_id: "mentor", note: "mornings", deleted_at: null }, { onConflict: "member_id" }] });
    expect(mocks.revalidate).toHaveBeenCalledWith("/big-sisters");
  });
  it("stores an omitted volunteer note as null", async () => {
    const db = await mocks.client(); await setBigSisterAvailability(true);
    expect(db.queries.at(-1)?.calls[0].args[0]).toEqual({ member_id: "mentor", note: null, deleted_at: null });
  });
  it("withdraws by soft-deleting only the caller's live volunteer row", async () => {
    const db = await mocks.client();
    expect(await setBigSisterAvailability(false)).toEqual({ success: true });
    const calls = db.queries[0].calls;
    expect(calls).toContainEqual({ method: "eq", args: ["member_id", "mentor"] });
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(calls[0].args[0]).toEqual({ deleted_at: expect.any(String) });
  });
  it.each([null, { first_joined_at: "2999-01-01", most_recent_joined_at: null }])("rejects missing or ineligible membership before writing", async (member) => {
    const db = createFakeSupabase({ members: { data: member } }); mocks.client.mockResolvedValue(db);
    expect(await setBigSisterAvailability(true)).toHaveProperty("error");
    expect(db.queries.every(q => q.table === "members")).toBe(true);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects oversized volunteer notes", async () => {
    expect(await setBigSisterAvailability(true, "x".repeat(301))).toEqual({ error: "Keep the note under 300 characters." });
  });
  it.each([true, false])("surfaces volunteer storage errors (available=%s)", async (available) => {
    mocks.client.mockResolvedValue(createFakeSupabase({ members: { data: { first_joined_at: "2020-01-01" } }, big_sister_volunteers: { error: { message: "write failed" } } }));
    expect(await setBigSisterAvailability(available)).toEqual({ error: "write failed" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("saves a reason through the restricted RPC and refreshes both member pages", async () => {
    const db = createFakeSupabase({ "rpc:set_mentorship_note": { data: true } }); mocks.client.mockResolvedValue(db);
    expect(await saveReasonNote("match", "too busy")).toEqual({ success: true });
    expect(db.queries[0].calls).toContainEqual({ method: "args", args: [{ p_mentorship_id: "match", p_note: "too busy" }] });
    expect(mocks.revalidate.mock.calls).toEqual([["/big-sisters"], ["/dashboard"]]);
  });
  it.each([{ data: false }, { error: { message: "denied" } }])("does not revalidate when a reason cannot be saved", async response => {
    mocks.client.mockResolvedValue(createFakeSupabase({ "rpc:set_mentorship_note": response }));
    expect(await saveReasonNote("match", "reason")).toEqual({ error: response.error?.message ?? "That isn't one of your matches." });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects oversized reasons without querying", async () => {
    expect(await saveReasonNote("match", "x".repeat(1001))).toEqual({ error: "Keep it under 1000 characters." });
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
