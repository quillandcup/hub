import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), arrivals: vi.fn(), introduce: vi.fn(), service: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/arrivals", () => ({ getArrivals: mocks.arrivals }));
vi.mock("@/lib/mentorship-intro", () => ({ sendMatchIntroductions: mocks.introduce }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

// The matches and volunteers live in the mentorship repository, in memory here.
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { addVolunteer, createMentorship, deleteMentorship, removeVolunteer, updateMentorship } from "@/app/(admin)/admin/mentorship/actions";

const mentor = "mbr_AAAAAAAAAAA1";
const member = "mbr_AAAAAAAAAAA2";
const input = { mentorMemberId: mentor, newMemberId: member };
const arrival = { memberId: member, arrivedOn: "2026-10-10", trialEndsOn: "2026-10-17", kind: "trial" };
const existingMatch = {
  id: "mtr_AAAAAAAAAAA1",
  mentor_member_id: mentor,
  new_member_id: member,
  started_on: arrival.arrivedOn,
  trial_ends_on: arrival.trialEndsOn,
  kind: "trial",
  status: "matched",
  outcome_note: null,
  created_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
};

function world(seed: ConstructorParameters<typeof InMemoryDataset>[0] = {}) {
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: mentor, name: "Mentor Example" },
        { id: member, name: "Member Example" },
      ],
      ...seed,
    })
  );
}
const matches = () => repos.mentorship.listWithMembers();
const failWith = (method: "create" | "update" | "delete" | "volunteer" | "withdraw", message: string) => {
  (repos.mentorship as unknown as Record<string, unknown>)[method] = async () => {
    throw new Error(message);
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  world();
  mocks.auth.mockResolvedValue({ ok: true, supabase: {}, user: { id: "admin" } });
  mocks.arrivals.mockResolvedValue([arrival]);
  mocks.service.mockReturnValue({ service: true });
});

describe("Big Sister staff actions", () => {
  it("requires admin authorization for every mutation", async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: "Forbidden" });
    for (const result of [await createMentorship(input), await updateMentorship("match", {}), await deleteMentorship("match"), await addVolunteer(member), await removeVolunteer(member)]) expect(result).toEqual({ error: "Forbidden" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.arrivals).not.toHaveBeenCalled();
  });

  it("creates the match with arrival facts and introduces both participants", async () => {
    expect(await createMentorship(input)).toEqual({ success: true });
    expect(await matches()).toEqual([
      expect.objectContaining({ mentor_member_id: mentor, new_member_id: member, started_on: arrival.arrivedOn, trial_ends_on: arrival.trialEndsOn, kind: "trial", status: "matched" }),
    ]);
    expect(mocks.introduce).toHaveBeenCalledWith({ service: true }, { ...input, startedOn: arrival.arrivedOn }, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/mentorship", "layout");
  });

  it("rejects invalid people and members without a recent arrival", async () => {
    expect(await createMentorship({ ...input, mentorMemberId: null })).toHaveProperty("error");
    expect(mocks.arrivals).not.toHaveBeenCalled();
    mocks.arrivals.mockResolvedValue([]);
    expect(await createMentorship(input)).toEqual({ error: expect.stringContaining("No recent sign-up") });
    expect(mocks.introduce).not.toHaveBeenCalled();
    expect(await matches()).toEqual([]);
  });

  it("refuses a second big sister for the same arrival, and reports other insert errors, without sending introductions", async () => {
    world({ mentorships: [existingMatch] });
    expect(await createMentorship(input)).toEqual({ error: expect.stringContaining("already has a big sister") });

    failWith("create", "database unavailable");
    expect(await createMentorship(input)).toEqual({ error: "database unavailable" });
    expect(mocks.introduce).not.toHaveBeenCalled();
  });

  it("updates a trimmed note and reassignment, or clears the note", async () => {
    world({ mentorships: [existingMatch] });
    expect(await updateMentorship(existingMatch.id, { outcomeNote: "  time  ", status: "reassigned" })).toEqual({ success: true });
    expect(await matches()).toEqual([expect.objectContaining({ outcome_note: "time", status: "reassigned" })]);
    expect(await updateMentorship(existingMatch.id, { outcomeNote: "  ", status: "matched" })).toEqual({ success: true });
    expect(await matches()).toEqual([expect.objectContaining({ outcome_note: null, status: "matched" })]);
  });

  it("rejects unknown status and leaves an empty update alone", async () => {
    expect(await updateMentorship("match", { status: "bad" as "matched" })).toEqual({ error: "Unknown status." });
    expect(await updateMentorship("match", {})).toEqual({ success: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("reports update errors, and that a reassigned match can't be restored beside a live one", async () => {
    world({ mentorships: [existingMatch, { ...existingMatch, id: "mtr_AAAAAAAAAAA2", status: "reassigned" }] });
    expect(await updateMentorship("mtr_AAAAAAAAAAA2", { status: "matched" })).toEqual({ error: expect.stringContaining("already has a big sister") });

    failWith("update", "write failed");
    expect(await updateMentorship("match", { status: "matched" })).toEqual({ error: "write failed" });
  });

  it("deletes the selected match and refreshes the tabs", async () => {
    world({ mentorships: [existingMatch] });
    expect(await deleteMentorship(existingMatch.id)).toEqual({ success: true });
    expect(await matches()).toEqual([]);
    expect(mocks.revalidate).toHaveBeenCalled();
  });

  it("reports deletion errors", async () => {
    failWith("delete", "blocked");
    expect(await deleteMentorship("match")).toEqual({ error: "blocked" });
  });

  it("validates the volunteer selection and note", async () => {
    for (const id of [null, "invalid"]) expect(await addVolunteer(id)).toEqual({ error: "Choose a member." });
    expect(await addVolunteer(member, "x".repeat(301))).toHaveProperty("error");
    expect(await repos.mentorship.volunteers()).toEqual([]);
  });

  it("adds and restores a volunteer with optional notes", async () => {
    expect(await addVolunteer(member, " mornings ")).toEqual({ success: true });
    expect(await repos.mentorship.volunteerNote(member)).toEqual({ note: "mornings" });
    await addVolunteer(member);
    expect(await repos.mentorship.volunteerNote(member)).toEqual({ note: null });
  });

  it("withdraws a volunteer without deleting their history", async () => {
    await addVolunteer(member, "mornings");
    expect(await removeVolunteer(member)).toEqual({ success: true });
    expect(await repos.mentorship.volunteers()).toEqual([]);
    expect(await repos.mentorship.volunteerNote(member)).toBeNull();
  });

  it("surfaces volunteer storage failures", async () => {
    failWith("volunteer", "denied");
    failWith("withdraw", "denied");
    expect(await addVolunteer(member)).toEqual({ error: "denied" });
    expect(await removeVolunteer(member)).toEqual({ error: "denied" });
  });
});
