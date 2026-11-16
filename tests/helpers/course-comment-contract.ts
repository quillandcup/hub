import { describe, it, expect, beforeEach } from "vitest";
import type { CourseCommentRepository } from "@/lib/data/course-comments";

export type CourseCommentContractContext = {
  repo: () => CourseCommentRepository;
  /** Two lessons of one course. */
  lessons: [string, string];
  courseId: string;
  lessonTitles: [string, string];
  /** Three members: two ordinary ones and a staff member. */
  members: { ada: string; bea: string; staff: string };
  /** Sets (or clears) a member's display name; the legal name is the one the member was made with. */
  setDisplayName: (memberId: string, displayName: string | null) => Promise<void>;
  /** Inserts `count` live top-level comments on a lesson directly, for volume. */
  bulk: (lessonId: string, memberId: string, count: number) => Promise<void>;
  /** Removes every comment this context made. */
  clear: () => Promise<void>;
};

/** Behavior every `CourseCommentRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCourseCommentContract(name: string, setup: () => CourseCommentContractContext) {
  describe(`${name} (CourseCommentRepository contract)`, () => {
    let ctx: CourseCommentContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
      await ctx.setDisplayName(ctx.members.ada, null);
    });

    const post = (lessonId: string, memberId: string, body: string, parentId: string | null = null, isStaffReply = false) =>
      ctx.repo().create({ lessonId, memberId, parentId, body, isStaffReply });

    it("shows questions newest first and replies oldest first, and counts every live comment", async () => {
      const first = await post(ctx.lessons[0], ctx.members.ada, "First question");
      const second = await post(ctx.lessons[0], ctx.members.bea, "Second question");
      const replyA = await post(ctx.lessons[0], ctx.members.staff, "Answer one", first.id, true);
      const replyB = await post(ctx.lessons[0], ctx.members.ada, "Thanks", first.id);
      await post(ctx.lessons[1], ctx.members.ada, "Another lesson");

      const thread = await ctx.repo().threadFor(ctx.lessons[0]);

      expect(thread.entries.map((e) => e.comment.id)).toEqual([second.id, first.id]);
      expect(thread.entries[1].replies.map((r) => r.id)).toEqual([replyA.id, replyB.id]);
      expect(thread.entries[1].replies[0].isStaffReply).toBe(true);
      expect(thread.count).toBe(4);
    });

    it("keeps one level: a reply goes under a top-level comment on the same lesson", async () => {
      const top = await post(ctx.lessons[0], ctx.members.ada, "Question");
      const reply = await post(ctx.lessons[0], ctx.members.bea, "Reply", top.id);

      await expect(post(ctx.lessons[0], ctx.members.ada, "Reply to a reply", reply.id)).rejects.toThrow();
      await expect(post(ctx.lessons[1], ctx.members.ada, "Reply on another lesson", top.id)).rejects.toThrow();
      expect((await ctx.repo().threadFor(ctx.lessons[0])).count).toBe(2);
    });

    it("holds the text to 1 to 4,000 characters", async () => {
      await expect(post(ctx.lessons[0], ctx.members.ada, "")).rejects.toThrow();
      await expect(post(ctx.lessons[0], ctx.members.ada, "x".repeat(4001))).rejects.toThrow();
      await expect(post(ctx.lessons[0], ctx.members.ada, "x".repeat(4000))).resolves.toMatchObject({ body: "x".repeat(4000) });
    });

    it("stores the text as typed, with its line breaks and characters", async () => {
      const typed = "Line one\nLine <b>two</b> & more &amp; https://example.com/a?b=1&c=2";
      const made = await post(ctx.lessons[0], ctx.members.ada, typed);

      expect((await ctx.repo().byId(made.id))?.body).toBe(typed);
      expect((await ctx.repo().threadFor(ctx.lessons[0])).entries[0].comment.body).toBe(typed);
    });

    it("edits the text and stamps when, and says null for a comment that is not there", async () => {
      const made = await post(ctx.lessons[0], ctx.members.ada, "Before");
      expect(made.editedAt).toBeNull();

      const edited = await ctx.repo().edit(made.id, "After", "2027-01-02T03:04:05.000Z");

      expect(edited).toMatchObject({ body: "After" });
      expect(new Date(edited!.editedAt!).toISOString()).toBe("2027-01-02T03:04:05.000Z");
      expect((await ctx.repo().threadFor(ctx.lessons[0])).entries[0].comment.editedAt).not.toBeNull();
      expect(await ctx.repo().edit("cmnt_ZZZZZZZZZZZZ", "x", "2027-01-02T03:04:05.000Z")).toBeNull();
      expect(await ctx.repo().byId("cmnt_ZZZZZZZZZZZZ")).toBeNull();
    });

    it("drops a deleted comment that has no replies and keeps a tombstone for one that has", async () => {
      const alone = await post(ctx.lessons[0], ctx.members.ada, "Nobody answered");
      const answered = await post(ctx.lessons[0], ctx.members.bea, "Secret text of a removed question");
      await post(ctx.lessons[0], ctx.members.staff, "An answer", answered.id, true);

      expect(await ctx.repo().softDelete(alone.id, ctx.members.ada, "2027-01-02T03:04:05.000Z")).toBe(true);
      expect(await ctx.repo().softDelete(answered.id, ctx.members.bea, "2027-01-02T03:04:05.000Z")).toBe(true);

      const thread = await ctx.repo().threadFor(ctx.lessons[0]);
      expect(thread.entries).toHaveLength(1);
      const tomb = thread.entries[0].comment;
      expect(tomb).toMatchObject({ id: answered.id, removed: true, body: null, authorName: "", isStaffReply: false });
      expect(JSON.stringify(thread)).not.toContain("Secret text");
      expect(thread.entries[0].replies).toHaveLength(1);
      // The tombstone is not a live comment.
      expect(thread.count).toBe(1);
      // The row is still there for staff, with its text.
      expect((await ctx.repo().byId(answered.id))?.deletedAt).not.toBeNull();
    });

    it("drops a deleted reply, and a question comes back to having no replies", async () => {
      const top = await post(ctx.lessons[0], ctx.members.ada, "Question");
      const reply = await post(ctx.lessons[0], ctx.members.staff, "Answer", top.id, true);

      await ctx.repo().softDelete(reply.id, ctx.members.staff, "2027-01-02T03:04:05.000Z");

      const thread = await ctx.repo().threadFor(ctx.lessons[0]);
      expect(thread.entries[0].replies).toEqual([]);
      expect(thread.count).toBe(1);
    });

    it("deletes once: a second delete keeps the first time, and a missing comment is false", async () => {
      const made = await post(ctx.lessons[0], ctx.members.ada, "Hello");

      await ctx.repo().softDelete(made.id, ctx.members.ada, "2027-01-02T03:04:05.000Z");
      await ctx.repo().softDelete(made.id, ctx.members.bea, "2027-02-02T03:04:05.000Z");

      expect(new Date((await ctx.repo().byId(made.id))!.deletedAt!).toISOString()).toBe("2027-01-02T03:04:05.000Z");
      expect(await ctx.repo().softDelete("cmnt_ZZZZZZZZZZZZ", ctx.members.ada, "2027-01-02T03:04:05.000Z")).toBe(false);
    });

    it("names an author by display name, else legal name, and keeps & and < as typed", async () => {
      await post(ctx.lessons[0], ctx.members.ada, "Hi");
      const legal = (await ctx.repo().threadFor(ctx.lessons[0])).entries[0].comment.authorName;
      expect(legal).toBeTruthy();

      await ctx.setDisplayName(ctx.members.ada, "Ada <Quill> & Co");

      expect((await ctx.repo().threadFor(ctx.lessons[0])).entries[0].comment.authorName).toBe("Ada <Quill> & Co");
    });

    it("reads a thread past 1,000 comments", async () => {
      await ctx.bulk(ctx.lessons[0], ctx.members.bea, 1050);
      await post(ctx.lessons[0], ctx.members.ada, "The newest one");

      const thread = await ctx.repo().threadFor(ctx.lessons[0]);

      expect(thread.count).toBe(1051);
      expect(thread.entries).toHaveLength(1051);
      expect(thread.entries[0].comment.body).toBe("The newest one");
    });

    it("lists the questions no staff reply answers, oldest first, with their lesson", async () => {
      const waitingA = await post(ctx.lessons[0], ctx.members.ada, "Waiting a");
      const answered = await post(ctx.lessons[0], ctx.members.bea, "Answered");
      const waitingB = await post(ctx.lessons[1], ctx.members.bea, "Waiting b");
      const deleted = await post(ctx.lessons[0], ctx.members.bea, "Deleted");
      const peerAnswered = await post(ctx.lessons[0], ctx.members.ada, "A peer replied only");
      await post(ctx.lessons[0], ctx.members.staff, "Staff answer", answered.id, true);
      await post(ctx.lessons[0], ctx.members.bea, "Peer reply", peerAnswered.id);
      await post(ctx.lessons[0], ctx.members.staff, "Staff note on their own", null, true);
      await ctx.repo().softDelete(deleted.id, ctx.members.bea, "2027-01-02T03:04:05.000Z");

      const waiting = await ctx.repo().unansweredQuestions(ctx.courseId);

      expect(waiting.map((q) => q.id)).toEqual([waitingA.id, waitingB.id, peerAnswered.id]);
      expect(waiting[0]).toMatchObject({ lessonId: ctx.lessons[0], lessonTitle: ctx.lessonTitles[0], body: "Waiting a" });
      expect(waiting[1].lessonTitle).toBe(ctx.lessonTitles[1]);
    });

    it("counts a question as waiting again once its only staff reply is deleted", async () => {
      const top = await post(ctx.lessons[0], ctx.members.ada, "Question");
      const answer = await post(ctx.lessons[0], ctx.members.staff, "Answer", top.id, true);
      expect(await ctx.repo().unansweredQuestions(ctx.courseId)).toEqual([]);

      await ctx.repo().softDelete(answer.id, ctx.members.staff, "2027-01-02T03:04:05.000Z");

      expect((await ctx.repo().unansweredQuestions(ctx.courseId)).map((q) => q.id)).toEqual([top.id]);
    });
  });
}
