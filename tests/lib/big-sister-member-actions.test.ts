import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const mocks = vi.hoisted(() => ({ user: vi.fn(), identity: vi.fn(), client: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: mocks.identity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

// The member's eligibility, volunteer row and match note come from their repositories, in memory here.
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { saveReasonNote, setBigSisterAvailability } from "@/app/(member)/big-sisters/actions";

const MENTOR = "mbr_AAAAAAAAAAA1";
const identity = { memberId: MENTOR, isSudo: false };
const match = {
  id: "mtr_AAAAAAAAAAA1",
  mentor_member_id: MENTOR,
  new_member_id: "mbr_AAAAAAAAAAA2",
  started_on: "2026-10-10",
  trial_ends_on: null,
  kind: "direct",
  status: "matched",
  outcome_note: null,
  created_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
};

function world(member: { firstJoinedAt: string | null; mostRecentJoinedAt?: string | null } | null = { firstJoinedAt: "2020-01-01" }) {
  repos = createInMemoryRepos(
    new InMemoryDataset({ members: member ? [{ id: MENTOR, name: "Mentor Example", ...member }] : [], mentorships: [match] })
  );
}
const failWith = (method: "volunteer" | "withdraw" | "setNote", message: string) => {
  (repos.mentorship as unknown as Record<string, unknown>)[method] = async () => {
    throw new Error(message);
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.identity.mockResolvedValue(identity);
  mocks.client.mockResolvedValue({});
  world();
});

describe("Big Sister member actions", () => {
  it.each([
    ["signed out", null, identity, "Not signed in"],
    ["without a member", { id: "user" }, null, "No member record"],
    ["sudo", { id: "user" }, { ...identity, isSudo: true }, "Viewing as a member is read-only."],
  ])("refuses both writes when %s", async (_name, user, effective, error) => {
    mocks.user.mockResolvedValue(user);
    mocks.identity.mockResolvedValue(effective);
    expect(await setBigSisterAvailability(true)).toEqual({ error });
    expect(await saveReasonNote(match.id, "reason")).toEqual({ error });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(await repos.mentorship.volunteers()).toEqual([]);
  });

  it("restores availability with a trimmed staff note for the caller only", async () => {
    expect(await setBigSisterAvailability(true, "  mornings  ")).toEqual({ success: true });
    expect(await repos.mentorship.volunteerNote(MENTOR)).toEqual({ note: "mornings" });
    expect(await repos.mentorship.volunteers()).toHaveLength(1);
    expect(mocks.revalidate).toHaveBeenCalledWith("/big-sisters");
  });

  it("stores an omitted volunteer note as null", async () => {
    await setBigSisterAvailability(true);
    expect(await repos.mentorship.volunteerNote(MENTOR)).toEqual({ note: null });
  });

  it("withdraws by taking only the caller off the pool", async () => {
    await setBigSisterAvailability(true, "mornings");
    expect(await setBigSisterAvailability(false)).toEqual({ success: true });
    expect(await repos.mentorship.volunteerNote(MENTOR)).toBeNull();
    expect(await repos.mentorship.volunteers()).toEqual([]);
  });

  it.each([null, { firstJoinedAt: "2999-01-01", mostRecentJoinedAt: null }])("rejects missing or ineligible membership before writing", async (member) => {
    world(member);
    expect(await setBigSisterAvailability(true)).toHaveProperty("error");
    expect(await repos.mentorship.volunteers()).toEqual([]);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("rejects oversized volunteer notes", async () => {
    expect(await setBigSisterAvailability(true, "x".repeat(301))).toEqual({ error: "Keep the note under 300 characters." });
    expect(await repos.mentorship.volunteers()).toEqual([]);
  });

  it.each([true, false])("surfaces volunteer storage errors (available=%s)", async (available) => {
    failWith("volunteer", "write failed");
    failWith("withdraw", "write failed");
    expect(await setBigSisterAvailability(available)).toEqual({ error: "write failed" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("saves a reason on the caller's match and refreshes both member pages", async () => {
    expect(await saveReasonNote(match.id, "too busy")).toEqual({ success: true });
    expect((await repos.mentorship.listWithMembers())[0].outcome_note).toBe("too busy");
    expect(mocks.revalidate.mock.calls).toEqual([["/big-sisters"], ["/dashboard"]]);
  });

  it("does not revalidate when a reason cannot be saved", async () => {
    expect(await saveReasonNote("mtr_NOTYOURMATCH", "reason")).toEqual({ error: "That isn't one of your matches." });

    failWith("setNote", "denied");
    expect(await saveReasonNote(match.id, "reason")).toEqual({ error: "denied" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("rejects oversized reasons without querying", async () => {
    expect(await saveReasonNote(match.id, "x".repeat(1001))).toEqual({ error: "Keep it under 1000 characters." });
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
