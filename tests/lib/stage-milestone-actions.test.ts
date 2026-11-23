import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The project-stage milestone prompt (docs/product/FINISHERS.md): what changing a project's status asks, and what the member's
// answer writes, over the in-memory repositories.

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const PROJECT = "wprj_AAAAAAAAAAA1";
const BO_PROJECT = "wprj_BBBBBBBBBBB1";
const USER = "11111111-1111-4111-8111-111111111111";

let data: InMemoryDataset;
let repos: ReturnType<typeof createInMemoryRepos>;
const recorded: Array<{ action: string; outcome: unknown }> = [];

vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => repos };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "browser") }));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ getMyBooks: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: vi.fn(() => ({})) }));
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

import { updateProjectPhase } from "@/app/(member)/projects/actions";
import { answerStageMilestone } from "@/app/(member)/projects/stageMilestoneActions";
import { addMilestone, answerMilestone } from "@/app/(member)/settings/milestoneActions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const identity = (memberId: string, isSudo = false) => ({ memberId, memberName: "x", memberEmail: "x@example.com", isSudo });
const project = (id: string, memberId: string, phase: string) => ({
  id,
  member_id: memberId,
  title: `Title ${id}`,
  description: null,
  cover_asset_id: null,
  cover_url: null,
  external_id: null,
  phase,
  show_on_profile: false,
  archived_at: null,
  created_at: "2026-01-01T10:00:00Z",
});

const setPhase = (phase: string) => {
  data.writingProjects.find((p) => p.id === PROJECT)!.phase = phase;
};
const mine = () => repos.milestones.ofMember(ADA);
/** Moves the project from one stage to another, as the status dropdown does. */
const move = async (from: string, to: string) => {
  setPhase(from);
  return updateProjectPhase(PROJECT, to as never);
};
const kindsAsked = (result: Awaited<ReturnType<typeof updateProjectPhase>>) => ("milestonePrompt" in result ? result.milestonePrompt?.kinds : undefined);

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example" },
      { id: BO, name: "Bo Example" },
    ],
    writingProjects: [project(PROJECT, ADA, "drafting"), project(BO_PROJECT, BO, "drafting")],
  });
  repos = createInMemoryRepos(data);
  vi.mocked(getCurrentUser).mockResolvedValue({ id: USER, email: "ada@example.com" });
  vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA));
});

describe("updateProjectPhase: what it asks after the status saved", () => {
  it("asks THE END when Drafting moves to First read-through, naming the project, and the status has saved", async () => {
    const result = await move("drafting", "first_read_through");
    expect(result).toEqual({ success: true, milestonePrompt: { projectId: PROJECT, projectTitle: `Title ${PROJECT}`, kinds: ["the_end"], offerPublish: false } });
    expect(data.writingProjects.find((p) => p.id === PROJECT)?.phase).toBe("first_read_through");
    expect(await mine()).toEqual([]);
  });

  it("asks nothing for Drafting to Hibernating, for Revising back to Drafting, or for a stage that is not forward", async () => {
    expect(await move("drafting", "hibernating")).toEqual({ success: true });
    expect(await move("revising", "drafting")).toEqual({ success: true });
    expect(await move("planning", "outlining")).toEqual({ success: true });
    expect(await move("revising", "beta_readers")).toEqual({ success: true });
  });

  it("asks both, once, when the project jumps straight to Publishing", async () => {
    expect(kindsAsked(await move("drafting", "publishing"))).toEqual(["the_end", "publish_ready"]);
  });

  it("asks only publish-ready when Revising reaches Publishing", async () => {
    expect(kindsAsked(await move("revising", "publishing"))).toEqual(["publish_ready"]);
  });

  it("offers the Publish flow on reaching Complete with no book", async () => {
    expect(await move("publishing", "complete")).toEqual({ success: true, milestonePrompt: { projectId: PROJECT, projectTitle: `Title ${PROJECT}`, kinds: [], offerPublish: true } });
  });

  it("does not offer the Publish flow when the project already has a book, but still asks THE END", async () => {
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: ADA, title: "A Book", published_date: "2026-01-01", cover_asset_id: null, project_id: PROJECT });
    expect(await move("publishing", "complete")).toEqual({ success: true });
    expect(await move("drafting", "complete")).toEqual({ success: true, milestonePrompt: expect.objectContaining({ kinds: ["the_end"], offerPublish: false }) });
  });

  it("does not ask again in the same stage group after 'not yet', as the project moves forward and back", async () => {
    expect(kindsAsked(await move("drafting", "first_read_through"))).toEqual(["the_end"]);
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_yet" })).toEqual({ success: true, saved: true });
    expect(await move("first_read_through", "drafting")).toEqual({ success: true });
    // Revising is in the same group as First read-through, where it was put off: not asked again.
    expect(await move("drafting", "revising")).toEqual({ success: true });
    expect(await move("revising", "line_copy_edit")).toEqual({ success: true });
  });

  it("asks THE END again at Publishing after a 'not yet' at First read-through, together with publish-ready", async () => {
    await move("drafting", "first_read_through");
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
    expect(kindsAsked(await move("first_read_through", "publishing"))).toEqual(["the_end", "publish_ready"]);
  });

  it("asks only once in each group: a second 'not yet' at Publishing waits for Complete, and one at Complete is the last", async () => {
    await move("drafting", "first_read_through");
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
    expect(kindsAsked(await move("first_read_through", "publishing"))).toEqual(["the_end", "publish_ready"]);
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
    await answerStageMilestone({ projectId: PROJECT, kind: "publish_ready", answer: "not_yet" });
    // Still Publishing: the same group, nothing more; the publish-ready question has no later stage that means it.
    expect(await move("publishing", "publishing")).toEqual({ success: true });
    expect(kindsAsked(await move("publishing", "complete"))).toEqual(["the_end"]);
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
    expect(await move("complete", "complete")).toEqual({ success: true });
    expect(data.memberMilestoneSnoozes.map((r) => [r.kind, r.stage_group]).sort()).toEqual([["publish_ready", 2], ["the_end", 3]]);
  });

  it("never asks again after 'Not for this work', whatever the stage", async () => {
    await move("drafting", "first_read_through");
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_for_this_work" })).toEqual({ success: true, saved: true });
    expect(kindsAsked(await move("first_read_through", "publishing"))).toEqual(["publish_ready"]);
    expect(await move("publishing", "complete")).toEqual({ success: true, milestonePrompt: expect.objectContaining({ kinds: [], offerPublish: true }) });
    expect(await mine()).toEqual([expect.objectContaining({ kind: "the_end", status: "declined", source: "project_stage" })]);
    expect(data.memberMilestoneSnoozes).toEqual([]);
  });

  it("does not ask when the project already has the milestone, in any status", async () => {
    await repos.milestones.propose({ memberId: ADA, kind: "the_end", work: { projectId: PROJECT, bookId: null, title: null }, achievedOn: null, createdBy: USER });
    expect(await move("drafting", "revising")).toEqual({ success: true });
    // A proposal for THE END does not stop the publish-ready question.
    expect(kindsAsked(await move("drafting", "publishing"))).toEqual(["publish_ready"]);
  });

  it("does not ask again about one the member took back", async () => {
    const { milestone } = await repos.milestones.addOwn(
      { memberId: ADA, kind: "the_end", answer: { status: "confirmed", achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: null, consent_testimonial: false }, work: { projectId: PROJECT, bookId: null, title: null }, createdBy: USER },
      new Date(),
    );
    await repos.milestones.takeBack(milestone.id, ADA, new Date());
    expect(await move("drafting", "revising")).toEqual({ success: true });
  });

  it("asks nothing in sudo, and the status still saves", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await move("drafting", "revising")).toEqual({ success: true });
    expect(data.writingProjects.find((p) => p.id === PROJECT)?.phase).toBe("revising");
  });

  it("never lets the question get in the way of the status: a failed lookup means no prompt", async () => {
    vi.spyOn(repos.milestones, "askedKinds").mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await move("drafting", "revising")).toEqual({ success: true });
    expect(data.writingProjects.find((p) => p.id === PROJECT)?.phase).toBe("revising");
    spy.mockRestore();
  });

  it("does not look at the milestones when the move asks nothing", async () => {
    const spy = vi.spyOn(repos.milestones, "askedKinds");
    await move("revising", "drafting");
    expect(spy).not.toHaveBeenCalled();
  });

  it("changes nothing about milestones the member already has when the project goes back or to Hibernating", async () => {
    await repos.milestones.addOwn(
      { memberId: ADA, kind: "the_end", answer: { status: "confirmed", achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: null, consent_testimonial: false }, work: { projectId: PROJECT, bookId: null, title: null }, createdBy: USER, source: "project_stage" },
      new Date(),
    );
    await move("revising", "drafting");
    await move("drafting", "hibernating");
    expect(await mine()).toEqual([expect.objectContaining({ kind: "the_end", status: "confirmed", source: "project_stage" })]);
  });

  it("still refuses a stage that cannot be set by hand", async () => {
    expect(await updateProjectPhase(PROJECT, "published" as never)).toEqual({ error: "Invalid phase" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("answerStageMilestone", () => {
  it("records THE END for the project as confirmed with source project_stage, with the date and story, and the outcome", async () => {
    const result = await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes", achievedOn: "2026-05-01", storyAfter: "At last.", shareStory: true });
    expect(result).toEqual({ success: true, saved: true });
    expect(await mine()).toEqual([
      expect.objectContaining({ kind: "the_end", status: "confirmed", source: "project_stage", projectId: PROJECT, bookId: null, achievedOn: "2026-05-01", storyAfter: "At last.", consentTestimonial: true }),
    ]);
    expect(data.memberMilestones[0].created_by).toBe(USER);
    expect(recorded).toEqual([{ action: "milestone_stage_answered", outcome: { ok: true, detail: "confirmed" } }]);
  });

  it("saves the level the member picked in the dialog (the lock, the house or the globe), and the globe when none was named", async () => {
    for (const [kind, level] of [["the_end", "private"], ["publish_ready", "community"]] as const) {
      expect(await answerStageMilestone({ projectId: PROJECT, kind, answer: "yes", visibility: level })).toEqual({ success: true, saved: true });
    }
    const other = "wprj_CCCCCCCCCCC1";
    data.writingProjects.push(project(other, ADA, "drafting"));
    await answerStageMilestone({ projectId: other, kind: "the_end", answer: "yes", visibility: "public" });
    await answerStageMilestone({ projectId: other, kind: "publish_ready", answer: "yes" });
    const rows = await mine();
    const level = (projectId: string, kind: string) => rows.find((m) => m.projectId === projectId && m.kind === kind)?.visibility;
    expect([level(PROJECT, "the_end"), level(PROJECT, "publish_ready"), level(other, "the_end"), level(other, "publish_ready")]).toEqual(["private", "community", "public", "public"]);
  });

  it("refuses a level that does not exist and writes nothing", async () => {
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes", visibility: "everyone" })).toHaveProperty("error");
    expect(data.memberMilestones).toEqual([]);
  });

  it("lets the member still say 'I wrote THE END' after 'Not for this work': the declined row is confirmed in place, and a second add shows it", async () => {
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_for_this_work" });
    const [declined] = await mine();
    expect(declined).toMatchObject({ status: "declined", source: "project_stage" });

    // The card shows "Actually, it is me" on that row, which answers it.
    expect(await answerMilestone({ id: declined.id, answer: "confirm", achievedOn: "2026-05-01", visibility: "community" })).toEqual({ success: true });
    expect(await mine()).toEqual([expect.objectContaining({ id: declined.id, status: "confirmed", source: "project_stage", achievedOn: "2026-05-01", visibility: "community" })]);

    // And the card's own "I wrote THE END" add finds that row instead of failing or duplicating it.
    expect(await addMilestone({ kind: "the_end", projectId: PROJECT })).toEqual({ success: true, added: false });
    expect(await mine()).toHaveLength(1);
  });

  it("keeps the share tick off when it was not ticked or no story was written", async () => {
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes", shareStory: true });
    await answerStageMilestone({ projectId: PROJECT, kind: "publish_ready", answer: "yes", storyBefore: "Stuck." });
    expect((await mine()).map((m) => m.consentTestimonial)).toEqual([false, false]);
  });

  it("records 'not yet' as a snooze with the project's stage group, and no milestone", async () => {
    setPhase("publishing");
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "publish_ready", answer: "not_yet" })).toEqual({ success: true, saved: true });
    expect(await mine()).toEqual([]);
    expect(await repos.milestones.snoozesOf(ADA, PROJECT)).toEqual([{ kind: "publish_ready", stageGroup: 2 }]);
    expect(await repos.milestones.counts()).toEqual({ proposed: 0, confirmed: 0, declined: 0 });
    expect(recorded).toEqual([{ action: "milestone_stage_answered", outcome: { ok: true, detail: "not_yet" } }]);
  });

  it("records 'Not for this work' as a declined row that is private and carries no consent", async () => {
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "publish_ready", answer: "not_for_this_work" })).toEqual({ success: true, saved: true });
    expect(await mine()).toEqual([expect.objectContaining({ kind: "publish_ready", status: "declined", source: "project_stage", projectId: PROJECT, visibility: "private", consentTestimonial: false })]);
    expect(await repos.milestones.snoozesOf(ADA, PROJECT)).toEqual([]);
    expect(recorded).toEqual([{ action: "milestone_stage_answered", outcome: { ok: true, detail: "not_for_this_work" } }]);
  });

  it("lets the staff backfill propose a kind the member said 'not yet' to, but not one they said 'Not for this work' to", async () => {
    data.memberBooks.push({ id: "book_AAAAAAAAAAA2", member_id: ADA, title: "A Book", published_date: "2026-01-01", cover_asset_id: null, project_id: PROJECT });
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_yet" });
    await answerStageMilestone({ projectId: PROJECT, kind: "publish_ready", answer: "not_for_this_work" });
    await repos.milestones.proposeFromBooks();
    expect((await mine()).map((m) => [m.kind, m.status, m.source]).sort()).toEqual([["publish_ready", "declined", "project_stage"], ["the_end", "proposed", "staff"]]);
  });

  it("says it was already there, and writes nothing, when the project has that milestone", async () => {
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes" });
    recorded.length = 0;
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes", storyAfter: "Different" })).toEqual({ success: true, saved: false });
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_yet" })).toEqual({ success: true, saved: false });
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "not_for_this_work" })).toEqual({ success: true, saved: false });
    expect(await mine()).toHaveLength(1);
    expect(data.memberMilestoneSnoozes).toEqual([]);
    expect((await mine())[0].storyAfter).toBeNull();
    expect(recorded.map((r) => r.outcome)).toEqual([{ ok: true, detail: "already_there" }, { ok: true, detail: "already_there" }, { ok: true, detail: "already_there" }]);
  });

  it("writes nothing for a project that is not the member's, or does not exist", async () => {
    expect(await answerStageMilestone({ projectId: BO_PROJECT, kind: "the_end", answer: "yes" })).toEqual({ error: "We couldn't find that project." });
    expect(await answerStageMilestone({ projectId: "wprj_ZZZZZZZZZZZZ", kind: "the_end", answer: "not_yet" })).toEqual({ error: "We couldn't find that project." });
    expect(await answerStageMilestone({ projectId: BO_PROJECT, kind: "the_end", answer: "not_for_this_work" })).toEqual({ error: "We couldn't find that project." });
    expect(await answerStageMilestone({ projectId: "", kind: "the_end", answer: "yes" })).toEqual({ error: "We couldn't find that project." });
    expect(data.memberMilestones).toEqual([]);
    expect(data.memberMilestoneSnoozes).toEqual([]);
  });

  it("refuses a kind that is not a milestone, a date still ahead, and a story that is too long", async () => {
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "published", answer: "yes" })).toHaveProperty("error");
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes", achievedOn: "2999-01-01" })).toHaveProperty("error");
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes", storyAfter: "x".repeat(2001) })).toHaveProperty("error");
    expect(data.memberMilestones).toEqual([]);
  });

  it("answers only for the signed-in member, never an admin viewing as them", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes" })).toEqual({ error: "Only the member can answer this." });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes" })).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes" })).toEqual({ error: "Please sign in again." });
    expect(data.memberMilestones).toEqual([]);
    expect(recorded.every((r) => (r.outcome as { ok: boolean }).ok === false)).toBe(true);
  });

  it("refreshes the pages that show milestones", async () => {
    await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer: "yes" });
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/[id]", "page");
    expect(revalidatePath).toHaveBeenCalledWith(`/members/${ADA}`);
  });

  it.each([["not_yet", "snooze"], ["not_for_this_work", "recordNotForThisWork"]] as const)("tells the member to try again when saving '%s' fails, without leaking the reason", async (answer, method) => {
    vi.spyOn(repos.milestones, method).mockRejectedValue(new Error("secret db detail"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await answerStageMilestone({ projectId: PROJECT, kind: "the_end", answer });
    expect(result).toEqual({ error: "We couldn't save that. Please try again in a moment." });
    spy.mockRestore();
  });
});
