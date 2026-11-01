import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), arrivals: vi.fn(), introduce: vi.fn(), service: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/arrivals", () => ({ getArrivals: mocks.arrivals }));
vi.mock("@/lib/mentorship-intro", () => ({ sendMatchIntroductions: mocks.introduce }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { addVolunteer, createMentorship, deleteMentorship, removeVolunteer, updateMentorship } from "@/app/(admin)/admin/mentorship/actions";
const mentor = "mbr_AAAAAAAAAAA1";
const member = "mbr_AAAAAAAAAAA2";
const input = { mentorMemberId: mentor, newMemberId: member };
const arrival = { memberId: member, arrivedOn: "2026-10-10", trialEndsOn: "2026-10-17", kind: "trial" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, supabase: createFakeSupabase(), user: { id: "admin" } });
  mocks.arrivals.mockResolvedValue([arrival]); mocks.service.mockReturnValue({ service: true });
});
describe("Big Sister staff actions", () => {
  it("requires admin authorization for every mutation", async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: "Forbidden" });
    for (const result of [await createMentorship(input), await updateMentorship("match", {}), await deleteMentorship("match"), await addVolunteer(member), await removeVolunteer(member)]) expect(result).toEqual({ error: "Forbidden" });
    expect(mocks.revalidate).not.toHaveBeenCalled(); expect(mocks.arrivals).not.toHaveBeenCalled();
  });
  it("creates the match with arrival facts and introduces both participants", async () => {
    const { supabase } = await mocks.auth();
    expect(await createMentorship(input)).toEqual({ success: true });
    expect(supabase.queries[0].calls).toContainEqual({ method: "insert", args: [{ mentor_member_id: mentor, new_member_id: member, started_on: arrival.arrivedOn, trial_ends_on: arrival.trialEndsOn, kind: "trial" }] });
    expect(mocks.introduce).toHaveBeenCalledWith({ service: true }, { ...input, startedOn: arrival.arrivedOn }, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/mentorship", "layout");
  });
  it("rejects invalid people and members without a recent arrival", async () => {
    expect(await createMentorship({ ...input, mentorMemberId: null })).toHaveProperty("error");
    expect(mocks.arrivals).not.toHaveBeenCalled(); mocks.arrivals.mockResolvedValue([]);
    expect(await createMentorship(input)).toEqual({ error: expect.stringContaining("No recent sign-up") });
    expect(mocks.introduce).not.toHaveBeenCalled();
  });
  it.each(["23505", "XX000"])("reports insert errors without sending introductions (%s)", async code => {
    mocks.auth.mockResolvedValue({ ok: true, supabase: createFakeSupabase({ mentorships: { error: { code, message: "database unavailable" } } }) });
    expect(await createMentorship(input)).toEqual({ error: code === "23505" ? expect.stringContaining("already has a big sister") : "database unavailable" });
    expect(mocks.introduce).not.toHaveBeenCalled();
  });
  it("updates a trimmed note and reassignment, or clears the note", async () => {
    const { supabase } = await mocks.auth();
    expect(await updateMentorship("match", { outcomeNote: "  time  ", status: "reassigned" })).toEqual({ success: true });
    expect(supabase.queries[0].calls).toContainEqual({ method: "update", args: [{ outcome_note: "time", status: "reassigned" }] });
    expect(await updateMentorship("match", { outcomeNote: "  ", status: "matched" })).toEqual({ success: true });
    expect(supabase.queries[1].calls[0].args[0]).toEqual({ outcome_note: null, status: "matched" });
  });
  it("rejects unknown status and leaves an empty update alone", async () => {
    expect(await updateMentorship("match", { status: "bad" as "matched" })).toEqual({ error: "Unknown status." });
    expect(await updateMentorship("match", {})).toEqual({ success: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(["23505", "XX000"])("reports update errors (%s)", async code => {
    mocks.auth.mockResolvedValue({ ok: true, supabase: createFakeSupabase({ mentorships: { error: { code, message: "write failed" } } }) });
    expect(await updateMentorship("match", { status: "matched" })).toEqual({ error: code === "23505" ? expect.stringContaining("already has a big sister") : "write failed" });
  });
  it("deletes the selected match and refreshes the tabs", async () => {
    const { supabase } = await mocks.auth(); expect(await deleteMentorship("match")).toEqual({ success: true });
    expect(supabase.queries[0].calls).toContainEqual({ method: "eq", args: ["id", "match"] });
    expect(mocks.revalidate).toHaveBeenCalled();
  });
  it("reports deletion errors", async () => {
    mocks.auth.mockResolvedValue({ ok: true, supabase: createFakeSupabase({ mentorships: { error: { message: "blocked" } } }) });
    expect(await deleteMentorship("match")).toEqual({ error: "blocked" });
  });
  it("validates the volunteer selection and note", async () => {
    for (const id of [null, "invalid"]) expect(await addVolunteer(id)).toEqual({ error: "Choose a member." });
    expect(await addVolunteer(member, "x".repeat(301))).toHaveProperty("error");
  });
  it("adds and restores a volunteer with optional notes", async () => {
    const { supabase } = await mocks.auth(); expect(await addVolunteer(member, " mornings ")).toEqual({ success: true });
    expect(supabase.queries[0].calls[0].args[0]).toEqual({ member_id: member, note: "mornings", deleted_at: null });
    await addVolunteer(member); expect(supabase.queries[1].calls[0].args[0]).toEqual({ member_id: member, note: null, deleted_at: null });
  });
  it("withdraws a volunteer without deleting their history", async () => {
    const { supabase } = await mocks.auth(); expect(await removeVolunteer(member)).toEqual({ success: true });
    expect(supabase.queries[0].calls).toEqual(expect.arrayContaining([{ method: "update", args: [{ deleted_at: expect.any(String) }] }, { method: "eq", args: ["member_id", member] }, { method: "is", args: ["deleted_at", null] }]));
  });
  it("surfaces volunteer storage failures", async () => {
    mocks.auth.mockResolvedValue({ ok: true, supabase: createFakeSupabase({ big_sister_volunteers: { error: { message: "denied" } } }) });
    expect(await addVolunteer(member)).toEqual({ error: "denied" }); expect(await removeVolunteer(member)).toEqual({ error: "denied" });
  });
});
