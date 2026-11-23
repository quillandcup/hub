import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { MILESTONE_DEFAULT_VISIBILITY } from "@/lib/finishers";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const WORK = { projectId: null, bookId: null, title: "A Fake Novel" };
const STAFF_USER = "11111111-1111-4111-8111-111111111111";

let data: InMemoryDataset;
const recorded: Array<{ action: string; outcome: unknown }> = [];

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: vi.fn() }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: vi.fn(() => ({})) }));
vi.mock("@/lib/writer-profiles-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/writer-profiles-access")>();
  return { ...actual, memberHasWriterProfiles: vi.fn(async () => true) };
});
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

import { addMilestone, answerMilestone, setMilestoneShare, setMilestoneVisibility, takeBackMilestone } from "@/app/(member)/settings/milestoneActions";
import { revalidatePath } from "next/cache";
import { memberHasWriterProfiles } from "@/lib/writer-profiles-access";
import { loadWorksOfMember, proposeMilestone, proposeMilestonesFromBooks, withdrawMilestone } from "@/app/(admin)/admin/finishers/actions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { requireActionPermission } from "@/lib/admin-auth";

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
  vi.mocked(requireActionPermission).mockResolvedValue({ ok: true, user: { id: STAFF_USER, email: "staff@example.com" }, supabase: {} as never, role: "admin", roles: ["admin"], realRole: "admin", realRoles: ["admin"] });
  await createInMemoryRepos(data).milestones.propose({ memberId: ADA, kind: "the_end", work: WORK, achievedOn: null, createdBy: STAFF_USER });
});

const ownId = async () => (await createInMemoryRepos(data).milestones.ofMember(ADA))[0].id;

describe("answerMilestone", () => {
  it("confirms for the signed-in member, at the globe (the default), with the share consent off unless ticked, and records the outcome", async () => {
    const id = await ownId();
    const result = await answerMilestone({ id, answer: "confirm", achievedOn: "2026-05-01", storyAfter: "At last." });
    expect(result).toEqual({ success: true });
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0]).toMatchObject({
      status: "confirmed",
      achievedOn: "2026-05-01",
      storyAfter: "At last.",
      visibility: MILESTONE_DEFAULT_VISIBILITY,
      consentTestimonial: false,
    });
    expect(recorded).toEqual([{ action: "milestone_answered", outcome: { ok: true, detail: "confirmed" } }]);
  });

  it("keeps the share consent only when a story was written", async () => {
    const id = await ownId();
    await answerMilestone({ id, answer: "confirm", shareStory: true });
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0].consentTestimonial).toBe(false);
    await answerMilestone({ id, answer: "confirm", storyBefore: "Stuck.", shareStory: true });
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0].consentTestimonial).toBe(true);
  });

  it("declines, which keeps no consent", async () => {
    const id = await ownId();
    expect(await answerMilestone({ id, answer: "decline" })).toEqual({ success: true });
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0]).toMatchObject({ status: "declined", visibility: "private", consentTestimonial: false });
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

  it("adds a confirmed milestone of the member's own, at the globe (the default), the share consent off unless ticked, and records the outcome", async () => {
    const result = await addMilestone({ kind: "the_end", title: "A Fake Novel", achievedOn: "2026-05-01", storyBefore: "Stuck.", shareStory: true });
    expect(result).toEqual({ success: true, added: true });
    expect(await mine()).toEqual([
      expect.objectContaining({ kind: "the_end", status: "confirmed", source: "member", achievedOn: "2026-05-01", storyBefore: "Stuck.", visibility: MILESTONE_DEFAULT_VISIBILITY, consentTestimonial: true }),
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

  it("links one of the member's own books, taking its project, and refuses someone else's or a mismatched project", async () => {
    const repos = createInMemoryRepos(data);
    const project = await repos.writing.createProject(ADA, "A Fake Novel", "drafting");
    const other = await repos.writing.createProject(ADA, "Another Fake Novel", "drafting");
    data.memberBooks.push({ ...BOOK, member_id: ADA, project_id: project });
    data.memberBooks.push({ ...BOOK, id: "book_BBBBBBBBBBB1", member_id: BO, project_id: null });
    expect(await addMilestone({ kind: "the_end", bookId: "book_BBBBBBBBBBB1" })).toEqual({ error: "We couldn't find that book." });
    expect(await addMilestone({ kind: "the_end", bookId: BOOK.id, projectId: other })).toEqual({ error: "That book belongs to a different project." });
    expect(await addMilestone({ kind: "the_end", bookId: BOOK.id })).toEqual({ success: true, added: true });
    expect((await mine())[0]).toMatchObject({ bookId: BOOK.id, projectId: project, title: null });
    // The project alone is the same work as its book.
    expect(await addMilestone({ kind: "the_end", projectId: project })).toEqual({ success: true, added: false });
  });

  it("needs a work: one of theirs, or a title, and keeps the title short", async () => {
    expect(await addMilestone({ kind: "the_end" })).toHaveProperty("error");
    expect(await addMilestone({ kind: "the_end", title: "   " })).toHaveProperty("error");
    expect(await addMilestone({ kind: "the_end", title: "x".repeat(121) })).toHaveProperty("error");
    expect(data.memberMilestones).toEqual([]);
  });

  it("lets the same kind be added for another work, and keeps one row per work", async () => {
    expect(await addMilestone({ kind: "the_end", title: "First Fake Work" })).toEqual({ success: true, added: true });
    expect(await addMilestone({ kind: "the_end", title: "Second Fake Work" })).toEqual({ success: true, added: true });
    expect(await addMilestone({ kind: "the_end", title: "first fake work" })).toEqual({ success: true, added: false });
    expect(await mine()).toHaveLength(2);
  });

  it("shows the existing one when the member adds the same kind for the same work twice, with no second row and no error", async () => {
    await addMilestone({ kind: "the_end", title: "A Fake Novel" });
    recorded.length = 0;
    expect(await addMilestone({ kind: "the_end", title: "a  fake NOVEL", storyAfter: "Again" })).toEqual({ success: true, added: false });
    expect(await mine()).toHaveLength(1);
    expect((await mine())[0].storyAfter).toBeNull();
    expect(recorded).toEqual([{ action: "milestone_added", outcome: { ok: true, detail: "already_there" } }]);
  });

  it("is refused for a sudo admin, a stranger, a missing member and a signed-out visitor, and writes nothing", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await addMilestone({ kind: "the_end", title: "A Fake Novel" })).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await addMilestone({ kind: "the_end", title: "A Fake Novel" })).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await addMilestone({ kind: "the_end", title: "A Fake Novel" })).toHaveProperty("error");
    expect(data.memberMilestones).toEqual([]);
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("tells the member what is wrong with the kind or the date and writes nothing", async () => {
    expect(await addMilestone({ kind: "published" })).toHaveProperty("error");
    expect(await addMilestone({ kind: "the_end", achievedOn: "2999-01-01" })).toHaveProperty("error");
    expect(data.memberMilestones).toEqual([]);
  });

  it("does not count as sending anything: no notification is created", async () => {
    await addMilestone({ kind: "the_end", title: "A Fake Novel" });
    expect(data.inAppNotifications).toEqual([]);
  });
});

describe("takeBackMilestone", () => {
  beforeEach(() => {
    data.memberMilestones = [];
  });

  it("takes back one the member added and lets them add it again, recording the outcome", async () => {
    await addMilestone({ kind: "the_end", title: "A Fake Novel" });
    const id = (await createInMemoryRepos(data).milestones.ofMember(ADA))[0].id;
    expect(await takeBackMilestone(id)).toEqual({ success: true });
    expect(await createInMemoryRepos(data).milestones.ofMember(ADA)).toEqual([]);
    expect(recorded.at(-1)).toEqual({ action: "milestone_taken_back", outcome: { ok: true } });
    expect(await takeBackMilestone(id)).toHaveProperty("error");
    expect(await addMilestone({ kind: "the_end", title: "A Fake Novel" })).toEqual({ success: true, added: true });
  });

  it("refuses staff-proposed rows, another member's rows, sudo and signed-out callers", async () => {
    await createInMemoryRepos(data).milestones.propose({ memberId: ADA, kind: "publish_ready", work: WORK, achievedOn: null, createdBy: STAFF_USER });
    const staffRow = (await createInMemoryRepos(data).milestones.ofMember(ADA))[0].id;
    expect(await takeBackMilestone(staffRow)).toHaveProperty("error");
    expect(await takeBackMilestone("")).toHaveProperty("error");
    await addMilestone({ kind: "the_end", title: "A Fake Novel" });
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
    vi.mocked(requireActionPermission).mockResolvedValue({ ok: false, error: "Not authorized" });
    expect(await proposeMilestonesFromBooks()).toEqual({ error: "Not authorized" });
    expect(await proposeMilestone({ memberId: BO, kind: "the_end", title: "A Fake Novel" })).toEqual({ error: "Not authorized" });
    expect(await withdrawMilestone("mlst_x")).toEqual({ error: "Not authorized" });
    expect(await createInMemoryRepos(data).milestones.ofMember(BO)).toEqual([]);
  });

  it("add one by hand as a proposal, and say when it already exists", async () => {
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready", title: "A Fake Novel" })).toEqual({ success: true, added: true });
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready", title: "A Fake Novel" })).toEqual({ success: true, added: false });
    // Another work is another proposal; a work needs a title or one of the member's own.
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready", title: "Another Fake Work" })).toEqual({ success: true, added: true });
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready" })).toHaveProperty("error");
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready", projectId: "wpr_notmine" })).toEqual({ error: "That project is not this member's." });
    expect(await proposeMilestone({ memberId: BO, kind: "publish_ready", bookId: "book_notmine" })).toEqual({ error: "That book is not this member's." });
    expect((await createInMemoryRepos(data).milestones.ofMember(BO))[0]).toMatchObject({ kind: "publish_ready", status: "proposed", source: "staff" });
    expect(await proposeMilestone({ memberId: null, kind: "the_end", title: "A Fake Novel" })).toHaveProperty("error");
    expect(await proposeMilestone({ memberId: "not-an-id", kind: "the_end", title: "A Fake Novel" })).toHaveProperty("error");
    expect(await proposeMilestone({ memberId: BO, kind: "published", title: "A Fake Novel" })).toHaveProperty("error");
  });

  it("backfill from books proposes once and a second run adds nothing", async () => {
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: BO, title: "A Book", published_date: "2026-01-01", cover_asset_id: null });
    expect(await proposeMilestonesFromBooks()).toEqual({ success: true, proposals: 2, members: 1, books: 1 });
    expect(await proposeMilestonesFromBooks()).toEqual({ success: true, proposals: 0, members: 0, books: 0 });
  });

  it("backfill proposes per book: a member with several books gets several proposals", async () => {
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: BO, title: "One", published_date: "2026-01-01", cover_asset_id: null });
    data.memberBooks.push({ id: "book_AAAAAAAAAAA2", member_id: BO, title: "Two", published_date: "2026-02-01", cover_asset_id: null });
    expect(await proposeMilestonesFromBooks()).toEqual({ success: true, proposals: 4, members: 1, books: 2 });
  });

  it("lists a member's works for the hand-add picker: projects and books, a book with a project once", async () => {
    const repos = createInMemoryRepos(data);
    const project = await repos.writing.createProject(BO, "A Fake Novel", "drafting");
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: BO, title: "Its Book", published_date: "2026-01-01", cover_asset_id: null, project_id: project });
    data.memberBooks.push({ id: "book_AAAAAAAAAAA2", member_id: BO, title: "Loose Book", published_date: "2026-02-01", cover_asset_id: null, project_id: null });
    const result = await loadWorksOfMember(BO);
    expect(result).toEqual({
      success: true,
      works: [
        { projectId: project, bookId: "book_AAAAAAAAAAA1", title: "A Fake Novel" },
        { projectId: null, bookId: "book_AAAAAAAAAAA2", title: "Loose Book" },
      ],
    });
    expect(await loadWorksOfMember("nope")).toHaveProperty("error");
    vi.mocked(requireActionPermission).mockResolvedValue({ ok: false, error: "Not authorized" });
    expect(await loadWorksOfMember(BO)).toEqual({ error: "Not authorized" });
  });

  it("backfill skips a member who already added their own, and still proposes the kind they lack", async () => {
    data.memberBooks.push({ ...BOOK, member_id: BO });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(BO));
    await addMilestone({ kind: "the_end", bookId: BOOK.id });
    expect(await proposeMilestonesFromBooks()).toEqual({ success: true, proposals: 1, members: 1, books: 1 });
    const kinds = (await createInMemoryRepos(data).milestones.ofMember(BO)).map((m) => [m.kind, m.source, m.status]);
    expect(kinds).toEqual([["the_end", "member", "confirmed"], ["publish_ready", "staff", "proposed"]]);
  });

  it("take back a proposal but not one that was answered", async () => {
    const id = await ownId();
    await answerMilestone({ id, answer: "confirm" });
    expect(await withdrawMilestone(id)).toHaveProperty("error");
    await createInMemoryRepos(data).milestones.propose({ memberId: BO, kind: "the_end", work: WORK, achievedOn: null, createdBy: STAFF_USER });
    const boId = (await createInMemoryRepos(data).milestones.ofMember(BO))[0].id;
    expect(await withdrawMilestone(boId)).toEqual({ success: true });
  });
});

describe("setMilestoneVisibility", () => {
  const confirmedId = async () => {
    const repos = createInMemoryRepos(data);
    const { milestone } = await repos.milestones.addOwn(
      { memberId: ADA, kind: "publish_ready", work: WORK, createdBy: STAFF_USER, answer: { status: "confirmed", achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: "Done.", consent_testimonial: false } },
      new Date("2026-11-20T15:00:00Z"),
    );
    return milestone.id;
  };
  const level = async (id: string) => (await createInMemoryRepos(data).milestones.ofMember(ADA)).find((m) => m.id === id)?.visibility;

  it("sets the lock, house or globe on a confirmed milestone, revalidates what shows it, and records the level", async () => {
    const id = await confirmedId();
    expect(await setMilestoneVisibility(id, "private")).toEqual({ success: true });
    expect(await level(id)).toBe("private");
    expect(await setMilestoneVisibility(id, "public")).toEqual({ success: true });
    expect(await level(id)).toBe("public");
    expect(recorded).toEqual([
      { action: "milestone_visibility_set", outcome: { ok: true, detail: "private" } },
      { action: "milestone_visibility_set", outcome: { ok: true, detail: "public" } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/[id]", "page");
    expect(revalidatePath).toHaveBeenCalledWith(`/members/${ADA}`);
  });

  it("revalidates the member's writer profile on the web too, so a withdrawn level leaves on the next read", async () => {
    const id = await confirmedId();
    data.writerProfiles.push({ id: "wpf_1", member_id: ADA, handle: "ada-example", is_public: true } as never);
    await setMilestoneVisibility(id, "private");
    expect(revalidatePath).toHaveBeenCalledWith("/w/ada-example");
  });

  it("refuses a level that does not exist, and the globe when writer profiles are not open to the member", async () => {
    const id = await confirmedId();
    await createInMemoryRepos(data).milestones.setVisibility(id, ADA, "community", new Date());
    expect(await setMilestoneVisibility(id, "everyone")).toEqual({ error: "That choice is not available." });
    vi.mocked(memberHasWriterProfiles).mockResolvedValueOnce(false);
    expect(await setMilestoneVisibility(id, "public")).toEqual({ error: "Writer profiles are not open to you yet." });
    expect(await level(id)).toBe("community");
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("does not need the flag to go back to the lock or the house", async () => {
    const id = await confirmedId();
    vi.mocked(memberHasWriterProfiles).mockResolvedValue(false);
    expect(await setMilestoneVisibility(id, "private")).toEqual({ success: true });
    vi.mocked(memberHasWriterProfiles).mockResolvedValue(true);
  });

  it("refuses a proposal, someone else's milestone and a taken-back one", async () => {
    const proposed = await ownId();
    expect(await setMilestoneVisibility(proposed, "community")).toHaveProperty("error");
    expect((await createInMemoryRepos(data).milestones.ofMember(ADA))[0].visibility).toBe("private");
    const id = await confirmedId();
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(BO));
    expect(await setMilestoneVisibility(id, "private")).toHaveProperty("error");
    expect(await level(id)).toBe(MILESTONE_DEFAULT_VISIBILITY);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA));
    await createInMemoryRepos(data).milestones.takeBack(id, ADA, new Date());
    expect(await setMilestoneVisibility(id, "private")).toHaveProperty("error");
  });

  it("is look-only in sudo, and needs a signed-in member with a record and an id", async () => {
    const id = await confirmedId();
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await setMilestoneVisibility(id, "private")).toEqual({ error: "Only you can change who sees this." });
    expect(await level(id)).toBe(MILESTONE_DEFAULT_VISIBILITY);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await setMilestoneVisibility(id, "private")).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await setMilestoneVisibility(id, "private")).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue({ id: STAFF_USER, email: "ada@example.com" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA));
    expect(await setMilestoneVisibility("", "private")).toHaveProperty("error");
  });

  it("says so, without raising, when the save fails", async () => {
    const id = await confirmedId();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(createInMemoryRepos(data).milestones, "setVisibility");
    data.memberMilestones = null as never;
    expect(await setMilestoneVisibility(id, "private")).toEqual({ error: "We couldn't save that. Please try again in a moment." });
    spy.mockRestore();
  });
});

describe("setMilestoneShare", () => {
  const withStory = async (story: string | null) => {
    const { milestone } = await createInMemoryRepos(data).milestones.addOwn(
      { memberId: ADA, kind: "the_end", work: { projectId: null, bookId: null, title: "Another Fake Novel" }, createdBy: STAFF_USER, answer: { status: "confirmed", achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: story, consent_testimonial: false } },
      new Date("2026-11-20T15:00:00Z"),
    );
    return milestone.id;
  };
  const shared = async (id: string) => (await createInMemoryRepos(data).milestones.ofMember(ADA)).find((m) => m.id === id)?.consentTestimonial;

  it("ticks and unticks the consent on a milestone with a story, and records which", async () => {
    const id = await withStory("Done.");
    expect(await setMilestoneShare(id, true)).toEqual({ success: true });
    expect(await shared(id)).toBe(true);
    expect(await setMilestoneShare(id, false)).toEqual({ success: true });
    expect(await shared(id)).toBe(false);
    expect(recorded.map((r) => r.outcome)).toEqual([{ ok: true, detail: "shared" }, { ok: true, detail: "withdrawn" }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/members/${ADA}`);
  });

  it("refuses to tick without a story to share, but always lets them untick", async () => {
    const id = await withStory(null);
    expect(await setMilestoneShare(id, true)).toEqual({ error: "Write a story or add a photo first, and then you can share it." });
    expect(await shared(id)).toBe(false);
    expect(await setMilestoneShare(id, false)).toEqual({ success: true });
  });

  it("refuses a proposal (consent only exists on a confirmed milestone), someone else's and a missing one", async () => {
    expect(await setMilestoneShare(await ownId(), true)).toHaveProperty("error");
    expect(await setMilestoneShare(await ownId(), false)).toHaveProperty("error");
    const id = await withStory("Done.");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(BO));
    expect(await setMilestoneShare(id, true)).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA));
    expect(await shared(id)).toBe(false);
    expect(await setMilestoneShare("", true)).toHaveProperty("error");
  });

  it("is look-only in sudo and needs a signed-in member", async () => {
    const id = await withStory("Done.");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await setMilestoneShare(id, true)).toEqual({ error: "Only the member can change this." });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await setMilestoneShare(id, true)).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await setMilestoneShare(id, true)).toHaveProperty("error");
    expect(await shared(id)).toBe(false);
  });

  it("says so, without raising, when the save fails", async () => {
    const id = await withStory("Done.");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    data.memberMilestones = null as never;
    expect(await setMilestoneShare(id, false)).toEqual({ error: "We couldn't save that. Please try again in a moment." });
    spy.mockRestore();
  });
});
