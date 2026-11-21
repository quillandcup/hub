import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const state = vi.hoisted(() => ({ auth: { ok: true } as unknown, fail: null as Error | null }));
const revalidatePath = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ sent: [], dryRun: [] })));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/server", () => ({ after: (run: () => unknown) => void run() }));
vi.mock("@/lib/courses/comment-notifications", () => ({ notifyLessonComment: (...args: unknown[]) => notify(...args) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: (name: string, run: () => unknown) => run() }));
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: async () => state.auth }));

let data = new InMemoryDataset();
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return {
    ...actual,
    createRepos: () => {
      const repos = actual.createInMemoryRepos(data);
      if (!state.fail) return repos;
      return { ...repos, courseComments: { ...repos.courseComments, byId: repos.courseComments.byId.bind(repos.courseComments), moderate: async () => { throw state.fail; } } };
    },
  };
});

import {
  approveHeldLessonComment,
  deleteLessonCommentAsStaff,
  dismissLessonCommentReports,
  hideLessonComment,
  markLessonCommentHandled,
  unhideLessonComment,
} from "@/app/(admin)/admin/courses/comment-moderation-actions";

const COURSE = "crs_AAAAAAAAAAA1";
const OTHER_COURSE = "crs_AAAAAAAAAAA2";
const LESSON = "les_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";

const comments = () => createInMemoryRepos(data).courseComments;
const post = (body = "Words", held = false) => comments().create({ lessonId: LESSON, memberId: ADA, parentId: null, body, isStaffReply: false, held });

beforeEach(() => {
  data = new InMemoryDataset();
  state.auth = { ok: true, user: { id: "user-admin", email: "admin@example.test" }, supabase: {} };
  state.fail = null;
  revalidatePath.mockReset();
  notify.mockClear();
  data.members.push({ id: ADA, name: "Ada Example" }, { id: BEA, name: "Bea Example" });
  data.courseLessons.push({ id: LESSON, course_id: COURSE, state: "open", title: "One" } as never);
});

describe("the staff moderation actions", () => {
  const all = [
    ["hideLessonComment", hideLessonComment],
    ["unhideLessonComment", unhideLessonComment],
    ["deleteLessonCommentAsStaff", deleteLessonCommentAsStaff],
    ["approveHeldLessonComment", approveHeldLessonComment],
    ["markLessonCommentHandled", markLessonCommentHandled],
    ["dismissLessonCommentReports", dismissLessonCommentReports],
  ] as const;

  it.each(all)("%s is refused for someone who isn't an admin, and changes nothing", async (_name, action) => {
    const made = await post("Words", true);
    for (const error of ["Not authenticated", "Not authorized"]) {
      state.auth = { ok: false, error };
      expect(await action(COURSE, made.id)).toEqual({ error });
    }
    expect(await comments().byId(made.id)).toMatchObject({ hiddenAt: null, deletedAt: null, handledAt: null });
    expect((await comments().byId(made.id))?.heldAt).not.toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(all)("%s refuses a bad id, a missing comment, and a comment of another course", async (_name, action) => {
    const made = await post();
    expect((await action("nope", made.id)).error).toBe("That comment isn't there any more");
    expect((await action(COURSE, "nope")).error).toBe("That comment isn't there any more");
    expect((await action(COURSE, "cmnt_ZZZZZZZZZZZZ")).error).toBe("That comment isn't there any more");
    expect((await action(OTHER_COURSE, made.id)).error).toBe("That comment isn't there any more");
    expect(await comments().byId(made.id)).toMatchObject({ hiddenAt: null, deletedAt: null, handledAt: null });
  });

  it("hides, then shows again; a repeat says nothing changed", async () => {
    const made = await post();

    expect(await hideLessonComment(COURSE, made.id)).toEqual({ changed: true });
    expect((await comments().byId(made.id))?.hiddenAt).not.toBeNull();
    expect(await hideLessonComment(COURSE, made.id)).toEqual({ changed: false });
    expect(await unhideLessonComment(COURSE, made.id)).toEqual({ changed: true });
    expect((await comments().byId(made.id))?.hiddenAt).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${COURSE}/comments`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/courses", "layout");
  });

  it("deletes, approves a held comment, marks a question handled and dismisses reports", async () => {
    const doomed = await post("Bad");
    const held = await post("a b c d", true);
    const asked = await post("Needs nothing");
    const reported = await post("Reported");
    await comments().report({ commentId: reported.id, reporterId: BEA, reason: "Spam" });

    expect(await deleteLessonCommentAsStaff(COURSE, doomed.id)).toEqual({ changed: true });
    expect(await approveHeldLessonComment(COURSE, held.id)).toEqual({ changed: true });
    expect(await markLessonCommentHandled(COURSE, asked.id)).toEqual({ changed: true });
    expect(await dismissLessonCommentReports(COURSE, reported.id)).toEqual({ changed: true });

    expect((await comments().byId(doomed.id))?.deletedAt).not.toBeNull();
    expect((await comments().byId(held.id))?.heldAt).toBeNull();
    expect((await comments().byId(asked.id))?.handledAt).not.toBeNull();
    expect(await comments().openReports(COURSE)).toEqual([]);
    expect(await dismissLessonCommentReports(COURSE, reported.id)).toEqual({ changed: false });
  });

  it("reports a database failure without its text, and logs only the message", async () => {
    const made = await post("Private words");
    state.fail = new Error("permission denied");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await hideLessonComment(COURSE, made.id)).toEqual({ error: "Couldn't save that change" });

    expect(log).toHaveBeenCalledWith("lesson comment moderation failed:", "permission denied");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Private words");
    log.mockRestore();
  });
});

describe("approving a held reply", () => {
  it("tells the people the reply is for once it is released, and only then", async () => {
    const question = await post("Question");
    const heldReply = await comments().create({ lessonId: LESSON, memberId: BEA, parentId: question.id, body: "Held reply", isStaffReply: false, held: true });

    expect(await approveHeldLessonComment(COURSE, heldReply.id)).toEqual({ changed: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.anything(), heldReply.id);

    // Already released: nothing changed, nobody is told again.
    expect(await approveHeldLessonComment(COURSE, heldReply.id)).toEqual({ changed: false });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("tells no one about a held question (top-level comments reach followers in the daily note), nor for other actions", async () => {
    const heldQuestion = await post("Held question", true);
    expect(await approveHeldLessonComment(COURSE, heldQuestion.id)).toEqual({ changed: true });
    const other = await post("Other");
    expect(await hideLessonComment(COURSE, other.id)).toEqual({ changed: true });
    expect(notify).not.toHaveBeenCalled();
  });
});
