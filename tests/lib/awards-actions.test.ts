import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The actions scope their reads to effectiveIdentity.memberId and rely on RLS for writes. These tests run
// them over the in-memory awards repository and cover the soft delete: a member's delete sets deleted_at
// (the row stays until they ask us to remove it, /privacy) and every read and edit skips a deleted award.

const mocks = vi.hoisted(() => ({ repos: undefined as unknown as Repos }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => mocks.repos,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "auth-user-1", email: "m1@example.test" }),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/slack", () => ({
  notifyStaffNewAward: vi.fn().mockResolvedValue(undefined),
}));

import { addAward, deleteAward, getMyAwards, updateAward, type AwardInput } from "@/app/(member)/awards/actions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { notifyStaffNewAward } from "@/lib/slack";
import { revalidatePath } from "next/cache";

const MEMBER = "mbr_AAAAAAAAAAA1";
const IDENTITY = { memberId: MEMBER, memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };

const VALID_INPUT: AwardInput = { awardName: "Best Poem", workTitle: "A Poem", awardDate: "2026-03-15" };

let data: InMemoryDataset;
const award = (id: string, fields: Partial<InMemoryDataset["awards"][number]> = {}) => ({
  id,
  member_id: MEMBER,
  award_name: "Best Poem",
  category: null,
  work_title: "A Poem",
  book_id: null,
  project_id: null,
  award_date: "2026-03-15",
  url: null,
  notes: null,
  created_at: "2026-03-15T00:00:00Z",
  deleted_at: null,
  ...fields,
});

beforeEach(() => {
  vi.clearAllMocks();
  data = new InMemoryDataset({ members: [{ id: MEMBER, name: "Member One" }] });
  mocks.repos = createInMemoryRepos(data);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

describe("getMyAwards", () => {
  it("lists only the member's live awards", async () => {
    data.awards = [award("award-1"), award("award-2", { deleted_at: "2026-04-01T00:00:00Z" }), award("award-3", { member_id: "mbr_AAAAAAAAAAA2" })];

    expect(await getMyAwards()).toEqual([expect.objectContaining({ id: "award-1", awardName: "Best Poem", workTitle: "A Poem" })]);
  });

  it("lists nothing without a member", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await getMyAwards()).toEqual([]);
  });
});

describe("addAward", () => {
  it("saves the trimmed fields, tells staff and refreshes the pages", async () => {
    expect(await addAward({ ...VALID_INPUT, awardName: "  Best Poem  ", category: " Poetry ", url: "https://example.com/win" })).toEqual({ success: true });

    expect(data.awards).toEqual([expect.objectContaining({ member_id: MEMBER, award_name: "Best Poem", category: "Poetry", url: "https://example.com/win", notes: null })]);
    expect(notifyStaffNewAward).toHaveBeenCalledWith(expect.objectContaining({ awardName: "Best Poem", memberId: MEMBER }));
    expect(revalidatePath).toHaveBeenCalledWith("/awards");
  });

  it("surfaces a database error without telling staff", async () => {
    mocks.repos.awards.add = vi.fn().mockRejectedValue(new Error("boom"));

    expect(await addAward(VALID_INPUT)).toEqual({ error: "boom" });
    expect(notifyStaffNewAward).not.toHaveBeenCalled();
  });

  it("refuses a visitor who is not signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    expect(await addAward(VALID_INPUT)).toEqual({ error: "Not authenticated" });
  });
});

describe("updateAward", () => {
  it("replaces the fields of a live award", async () => {
    data.awards = [award("award-1")];

    expect(await updateAward("award-1", { ...VALID_INPUT, awardName: "Better Poem" })).toEqual({ success: true });
    expect(data.awards[0].award_name).toBe("Better Poem");
  });

  it("won't edit an award that was deleted", async () => {
    data.awards = [award("award-1", { deleted_at: "2026-04-01T00:00:00Z" })];

    expect(await updateAward("award-1", VALID_INPUT)).toEqual({ error: "Award not found" });
  });

  it("surfaces a database error", async () => {
    mocks.repos.awards.update = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await updateAward("award-1", VALID_INPUT)).toEqual({ error: "boom" });
  });
});

describe("deleteAward", () => {
  it("soft-deletes the award (sets deleted_at, keeps the row) and refreshes the pages", async () => {
    data.awards = [award("award-1")];

    expect(await deleteAward("award-1")).toEqual({ success: true });
    expect(data.awards).toEqual([expect.objectContaining({ id: "award-1", deleted_at: expect.any(String) })]);
    expect(revalidatePath).toHaveBeenCalledWith("/awards");
  });

  it("reports 'Award not found' when the row isn't the member's or is already deleted", async () => {
    expect(await deleteAward("someone-elses-award")).toEqual({ error: "Award not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces a database error", async () => {
    mocks.repos.awards.remove = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await deleteAward("award-1")).toEqual({ error: "boom" });
  });
});
