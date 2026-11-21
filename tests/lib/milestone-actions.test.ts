import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const STAFF_USER = "11111111-1111-4111-8111-111111111111";

let data: InMemoryDataset;
const recorded: Array<{ action: string; outcome: unknown }> = [];

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: vi.fn() }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => actual.createInMemoryRepos(data) };
});
vi.mock("@/lib/analytics/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/server")>();
  return {
    ...actual,
    withAction: async (action: string, run: () => Promise<unknown>, classify: (r: unknown) => unknown = actual.actionOutcome) => {
      const result = await run();
      recorded.push({ action, outcome: classify(result) });
      return result;
    },
  };
});

import { addMilestone, answerMilestone, takeBackMilestone } from "@/app/(member)/settings/milestoneActions";
import { proposeMilestone, proposeMilestonesFromBooks, withdrawMilestone } from "@/app/(admin)/admin/finishers/actions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { requireAdminAction } from "@/lib/admin-auth";

const identity = (memberId: string, isSudo = false) => ({ memberId, memberName: "x", memberEmail: "x@example.com", isSudo });

beforeEach(async () => {
  data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example" },
      { id: BO, name: "Bo Example" },
    ],
  });
  recorded.length = 0;
  vi.mocked(getCurrentUser).mockResolvedValue({ id: STAFF_USER, email: "ada@example.com" });
  vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA));
  vi.mocked(requireAdminAction).mockResolvedValue({ ok: true, user: { id: STAFF_USER, email: "staff@example.com" }, supabase: {} as never });
  await createInMemoryRepos(data).milestones.propose({ memberId: ADA, kind: "the_end", achievedOn: null, createdBy: STAFF_USER });
});

const ownId = async () => (await createInMemoryRepos(data).milestones.ofMember(ADA))[0].id;

describe("answerMilestone", () => {
  it("confirms for the signed-in member, with consents off unless ticked, and records the outcome", async () => {
    const id = await ownId();
    const result = await answerMilestone({ id, answer: "confirm", achievedOn: "2026-05-01", storyAfter: "At last.", consents: { consent_profile: true } });
    expect(result).toEqual({ success: true });
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0]).toMatchObject({
      status: "confirmed",
      achievedOn: "2026-05-01",
      storyAfter: "At last.",
      consentProfile: true,
      consentHomepage: false,
      consentTestimonial: false,
    });
    expect(recorded).toEqual([{ action: "milestone_answered", outcome: { ok: true, detail: "confirmed" } }]);
  });

  it("declines, which keeps no consent", async () => {
    const id = await ownId();
    expect(await answerMilestone({ id, answer: "decline" })).toEqual({ success: true });
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0]).toMatchObject({ status: "declined", consentProfile: false });
    expect(recorded[0].outcome).toEqual({ ok: true, detail: "declined" });
  });

  it("answers only for the signed-in member, never an admin viewing as them", async () => {
    const id = await ownId();
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await answerMilestone({ id, answer: "decline" })).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(BO));
    expect(await answerMilestone({ id, answer: "decline" })).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await answerMilestone({ id, answer: "decline" })).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await answerMilestone({ id, answer: "decline" })).toHaveProperty("error");
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0].status).toBe("proposed");
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("tells the member what is wrong with a date and changes nothing", async () => {
    const id = await ownId();
    const result = await answerMilestone({ id, answer: "confirm", achievedOn: "2999-01-01" });
    expect(result).toHaveProperty("error");
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0].status).toBe("proposed");
  });

  it("says so when the milestone was taken back", async () => {
    const id = await ownId();
    await createInMemoryRepos(data).milestones.withdraw(id);
    expect(await answerMilestone({ id, answer: "confirm" })).toHaveProperty("error");
  });
});

const BOOK = { id: "book_AAAAAAAAAAA1", title: "A Book", published_date: "2026-01-01", cover_asset_id: null };

describe("addMilestone", () => {
  beforeEach(() => {
    // Ada has the staff proposal from the outer setup; start these from a member with nothing.
    data.memberMilestones = [];
  });
  const mine = () => createInMemoryRepos(data).milestones.ofMember(ADA);

  it("adds a confirmed milestone of the member's own, consents off unless ticked, and records the outcome", async () => {
    const result = await addMilestone({ kind: "the_end", achievedOn: "2026-05-01", storyBefore: "Stuck.", consents: { consent_testimonial: true } });
    expect(result).toEqual({ success: true, added: true });
    expect(await mine()).toEqual([
      expect.objectContaining({ kind: "the_end", status: "confirmed", source: "member", achievedOn: "2026-05-01", storyBefore: "Stuck.", consentProfile: false, consentHomepage: false, consentTestimonial: true }),
    ]);
    expect(data.memberMilestones[0].created_by).toBe(STAFF_USER);
    expect(recorded).toEqual([{ action: "milestone_added", outcome: { ok: true, detail: "added" } }]);
  });

  it("links one of the member's own projects, and refuses someone else's", async () => {
    const repos = createInMemoryRepos(data);
    const own = await repos.writing.createProject(ADA, "A Fake Novel", "drafting");
    const theirs = await repos.writing.createProject(BO, "Another Fake Novel", "drafting");
    expect(await addMilestone({ kind: "publish_ready", projectId: theirs })).toEqual({ error: "We couldn't find that project." });
    expect(await mine()).toEqual([]);
    expect(await addMilestone({ kind: "publish_ready", projectId: own })).toEqual({ success: true, added: true });
    expect((await mine())[0].projectId).toBe(own);
  });

  it("shows the existing one when the member adds the same kind twice, with no second row and no error", async () => {
    await addMilestone({ kind: "the_end" });
    recorded.length = 0;
    expect(await addMilestone({ kind: "the_end", storyAfter: "Again" })).toEqual({ success: true, added: false });
    expect(await mine()).toHaveLength(1);
    expect((await mine())[0].storyAfter).toBeNull();
    expect(recorded).toEqual([{ action: "milestone_added", outcome: { ok: true, detail: "already_there" } }]);
  });

  it("is refused for a sudo admin, a stranger, a missing member and a signed-out visitor, and writes nothing", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await addMilestone({ kind: "the_end" })).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await addMilestone({ kind: "the_end" })).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await addMilestone({ kind: "the_end" })).toHaveProperty("error");
    expect(data.memberMilestones).toEqual([]);
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("tells the member what is wrong with the kind or the date and writes nothing", async () => {
    expect(await addMilestone({ kind: "published" })).toHaveProperty("error");
    expect(await addMilestone({ kind: "the_end", achievedOn: "2999-01-01" })).toHaveProperty("error");
    expect(data.memberMilestones).toEqual([]);
  });

  it("does not count as sending anything: no notification is created", async () => {
    await addMilestone({ kind: "the_end" });
    expect(data.inAppNotifications).toEqual([]);
  });
});

describe("takeBackMilestone", () => {
  beforeEach(() => {
    data.memberMilestones = [];
  });

  it("takes back one the member added and lets them add it again, recording the outcome", async () => {
    await addMilestone({ kind: "the_end" });
    const id = (await createInMemoryRepos(data).milestones.ofMember(ADA))[0].id;
    expect(await takeBackMilestone(id)).toEqual({ success: true });
    expect(await createInMemoryRepos(data).milestones.ofMember(ADA)).toEqual([]);
    expect(recorded.at(-1)).toEqual({ action: "milestone_taken_back", outcome: { ok: true } });
    expect(await takeBackMilestone(id)).toHaveProperty("error");
    expect(await addMilestone({ kind: "the_end" })).toEqual({ success: true, added: true });
  });

  it("refuses staff-proposed rows, another member's rows, sudo and signed-out callers", async () => {
    await createInMemoryRepos(data).milestones.propose({ memberId: ADA, kind: "publish_ready", achievedOn: null, createdBy: STAFF_USER });
    const staffRow = (await createInMemoryRepos(data).milestones.ofMember(ADA))[0].id;
    expect(await takeBackMilestone(staffRow)).toHaveProperty("error");
    expect(await takeBackMilestone("")).toHaveProperty("error");
    await addMilestone({ kind: "the_end" });
    const own = (await createInMemoryRepos(data).milestones.ofMember(ADA)).find((m) => m.source === "member")!.id;
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(BO));
    expect(await takeBackMilestone(own)).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await takeBackMilestone(own)).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await takeBackMilestone(own)).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await takeBackMilestone(own)).toHaveProperty("error");
    expect(await createInMemoryRepos(data).milestones.ofMember(ADA)).toHaveLength(2);
  });
});

describe("the staff actions", () => {
  it("refuse anyone who is not an admin", async () => {
    vi.mocked(requireAdminAction).mockResolvedValue({ ok: false, error: "Not authorized" });
    expect(await proposeMilestonesFromBooks()).toEqual({ error: "Not authorized" });
    expect(await proposeMilestone({ memberId: BO, kind: "the_end" })).toEqual({ error: "Not authorized" });
    expect(await withdrawMilestone("mlst_x")).toEqual({ error: "Not authorized" });
    expect(await createInMemoryRepos(data).milestones.ofMember(BO)).toEqual([]);
  });

  it("add one by hand as a proposal, and say when it already exists", async () => {
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready" })).toEqual({ success: true, added: true });
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready" })).toEqual({ success: true, added: false });
    expect((await createInMemoryRepos(data).milestones.ofMember(BO))[0]).toMatchObject({ kind: "publish_ready", status: "proposed", source: "staff" });
    expect(await proposeMilestone({ memberId: null, kind: "the_end" })).toHaveProperty("error");
    expect(await proposeMilestone({ memberId: "not-an-id", kind: "the_end" })).toHaveProperty("error");
    expect(await proposeMilestone({ memberId: BO, kind: "published" })).toHaveProperty("error");
  });

  it("backfill from books proposes once and a second run adds nothing", async () => {
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: BO, title: "A Book", published_date: "2026-01-01", cover_asset_id: null });
    expect(await proposeMilestonesFromBooks()).toEqual({ success: true, added: 2 });
    expect(await proposeMilestonesFromBooks()).toEqual({ success: true, added: 0 });
  });

  it("backfill skips a member who already added their own, and still proposes the kind they lack", async () => {
    data.memberBooks.push({ ...BOOK, member_id: BO });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(BO));
    await addMilestone({ kind: "the_end" });
    expect(await proposeMilestonesFromBooks()).toEqual({ success: true, added: 1 });
    const kinds = (await createInMemoryRepos(data).milestones.ofMember(BO)).map((m) => [m.kind, m.source, m.status]);
    expect(kinds).toEqual([["the_end", "member", "confirmed"], ["publish_ready", "staff", "proposed"]]);
  });

  it("take back a proposal but not one that was answered", async () => {
    const id = await ownId();
    await answerMilestone({ id, answer: "confirm" });
    expect(await withdrawMilestone(id)).toHaveProperty("error");
    await createInMemoryRepos(data).milestones.propose({ memberId: BO, kind: "the_end", achievedOn: null, createdBy: STAFF_USER });
    const boId = (await createInMemoryRepos(data).milestones.ofMember(BO))[0].id;
    expect(await withdrawMilestone(boId)).toEqual({ success: true });
  });
});
