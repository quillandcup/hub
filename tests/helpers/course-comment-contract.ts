import { describe, it, expect, beforeEach } from "vitest";
import type { CourseCommentRepository } from "@/lib/data/course-comments";

export type CourseCommentContractContext = {
  repo: () => CourseCommentRepository;
  /** Two lessons of one course. */
  lessons: [string, string];
  courseId: string;
  /** The course's slug and title, as `lessonInfo` should report them. */
  course: { slug: string; title: string };
  lessonTitles: [string, string];
  /** Three members: two ordinary ones and a staff member. */
  members: { ada: string; bea: string; staff: string };
  /** Sets (or clears) a member's display name; the legal name is the one the member was made with. */
  setDisplayName: (memberId: string, displayName: string | null) => Promise<void>;
  /** Inserts `count` live top-level comments on a lesson directly, for volume; held for review when `held`. */
  bulk: (lessonId: string, memberId: string, count: number, held?: boolean) => Promise<void>;
  /** Inserts `count` top-level comments by `authorId` on a lesson, each with one open report by `reporterId`, directly, for volume. */
  bulkReported: (lessonId: string, authorId: string, reporterId: string, count: number) => Promise<void>;
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

    const as = (memberId: string) => ({ memberId, isStaff: false });
    const staffView = () => ({ memberId: ctx.members.staff, isStaff: true });
    const AT = "2027-01-02T03:04:05.000Z";

    const post = (lessonId: string, memberId: string, body: string, parentId: string | null = null, isStaffReply = false) =>
      ctx.repo().create({ lessonId, memberId, parentId, body, isStaffReply });

    it("shows questions newest first and replies oldest first, and counts every live comment", async () => {
      const first = await post(ctx.lessons[0], ctx.members.ada, "First question");
      const second = await post(ctx.lessons[0], ctx.members.bea, "Second question");
      const replyA = await post(ctx.lessons[0], ctx.members.staff, "Answer one", first.id, true);
      const replyB = await post(ctx.lessons[0], ctx.members.ada, "Thanks", first.id);
      await post(ctx.lessons[1], ctx.members.ada, "Another lesson");

      const thread = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));

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
      expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).count).toBe(2);
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
      expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).entries[0].comment.body).toBe(typed);
    });

    it("edits the text and stamps when, and says null for a comment that is not there", async () => {
      const made = await post(ctx.lessons[0], ctx.members.ada, "Before");
      expect(made.editedAt).toBeNull();

      const edited = await ctx.repo().edit(made.id, "After", "2027-01-02T03:04:05.000Z");

      expect(edited).toMatchObject({ body: "After" });
      expect(new Date(edited!.editedAt!).toISOString()).toBe("2027-01-02T03:04:05.000Z");
      expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).entries[0].comment.editedAt).not.toBeNull();
      expect(await ctx.repo().edit("cmnt_ZZZZZZZZZZZZ", "x", "2027-01-02T03:04:05.000Z")).toBeNull();
      expect(await ctx.repo().byId("cmnt_ZZZZZZZZZZZZ")).toBeNull();
    });

    it("drops a deleted comment that has no replies and keeps a tombstone for one that has", async () => {
      const alone = await post(ctx.lessons[0], ctx.members.ada, "Nobody answered");
      const answered = await post(ctx.lessons[0], ctx.members.bea, "Secret text of a removed question");
      await post(ctx.lessons[0], ctx.members.staff, "An answer", answered.id, true);

      expect(await ctx.repo().softDelete(alone.id, ctx.members.ada, "2027-01-02T03:04:05.000Z")).toBe(true);
      expect(await ctx.repo().softDelete(answered.id, ctx.members.bea, "2027-01-02T03:04:05.000Z")).toBe(true);

      const thread = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));
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

      const thread = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));
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
      const legal = (await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).entries[0].comment.authorName;
      expect(legal).toBeTruthy();

      await ctx.setDisplayName(ctx.members.ada, "Ada <Quill> & Co");

      expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).entries[0].comment.authorName).toBe("Ada <Quill> & Co");
    });

    it("reads a thread past 1,000 comments", async () => {
      await ctx.bulk(ctx.lessons[0], ctx.members.bea, 1050);
      await post(ctx.lessons[0], ctx.members.ada, "The newest one");

      const thread = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));

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

    describe("moderation", () => {
      it("shows members a hidden comment as a tombstone and staff its text, and brings it back on unhide", async () => {
        const hidden = await post(ctx.lessons[0], ctx.members.ada, "Words staff hid");
        await post(ctx.lessons[0], ctx.members.staff, "An answer", hidden.id, true);

        expect(await ctx.repo().moderate(hidden.id, "hide", ctx.members.staff)).toBe("done");

        const forMember = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));
        expect(forMember.entries[0].comment).toMatchObject({ removed: true, body: null, authorName: "", hidden: false });
        expect(JSON.stringify(forMember)).not.toContain("Words staff hid");
        // The author is a member too: they see the tombstone, not their own text.
        expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.ada))).entries[0].comment.removed).toBe(true);
        const forStaff = await ctx.repo().threadFor(ctx.lessons[0], staffView());
        expect(forStaff.entries[0].comment).toMatchObject({ removed: false, hidden: true, body: "Words staff hid", authorName: expect.any(String) });
        // A hidden comment is not live: only the reply counts.
        expect(forStaff.count).toBe(1);

        expect(await ctx.repo().moderate(hidden.id, "hide", ctx.members.staff)).toBe("no_change");
        expect(await ctx.repo().moderate(hidden.id, "unhide", ctx.members.staff)).toBe("done");
        expect(await ctx.repo().moderate(hidden.id, "unhide", ctx.members.staff)).toBe("no_change");
        const after = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));
        expect(after.entries[0].comment).toMatchObject({ removed: false, hidden: false, body: "Words staff hid" });
        expect(after.count).toBe(2);
      });

      it("drops a hidden comment with no replies for members and keeps it for staff", async () => {
        const alone = await post(ctx.lessons[0], ctx.members.ada, "Alone");
        await ctx.repo().moderate(alone.id, "hide", ctx.members.staff);

        expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).entries).toEqual([]);
        expect((await ctx.repo().threadFor(ctx.lessons[0], staffView())).entries).toHaveLength(1);
      });

      it("holds a comment for its author and staff only, then releases it on approval", async () => {
        const held = await ctx.repo().create({ lessonId: ctx.lessons[0], memberId: ctx.members.ada, parentId: null, body: "a b c d", isStaffReply: false, held: true });
        await post(ctx.lessons[0], ctx.members.bea, "A normal one");
        expect(held.heldAt).not.toBeNull();

        const others = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));
        expect(others.entries.map((e) => e.comment.body)).toEqual(["A normal one"]);
        expect(JSON.stringify(others)).not.toContain("a b c d");
        const author = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.ada));
        expect(author.entries.find((e) => e.comment.id === held.id)?.comment).toMatchObject({ held: true, body: "a b c d", removed: false });
        expect(author.count).toBe(1);
        const staff = await ctx.repo().threadFor(ctx.lessons[0], staffView());
        expect(staff.entries.find((e) => e.comment.id === held.id)?.comment.held).toBe(true);

        expect((await ctx.repo().heldComments(ctx.courseId)).map((h) => h.id)).toEqual([held.id]);
        expect(await ctx.repo().moderate(held.id, "approve", ctx.members.staff)).toBe("done");
        expect(await ctx.repo().moderate(held.id, "approve", ctx.members.staff)).toBe("no_change");
        expect(await ctx.repo().heldComments(ctx.courseId)).toEqual([]);
        const released = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));
        expect(released.entries.map((e) => e.comment.body)).toEqual(["A normal one", "a b c d"]);
        expect(released.count).toBe(2);
      });

      it("keeps a held comment out of the unanswered list, and a held staff-free question comes back once approved", async () => {
        const held = await ctx.repo().create({ lessonId: ctx.lessons[0], memberId: ctx.members.ada, parentId: null, body: "x y z", isStaffReply: false, held: true });
        expect(await ctx.repo().unansweredQuestions(ctx.courseId)).toEqual([]);

        await ctx.repo().moderate(held.id, "approve", ctx.members.staff);

        expect((await ctx.repo().unansweredQuestions(ctx.courseId)).map((q) => q.id)).toEqual([held.id]);
      });

      it("takes a handled question off the unanswered list, once, and only a question", async () => {
        const question = await post(ctx.lessons[0], ctx.members.ada, "Needs no answer");
        const reply = await post(ctx.lessons[0], ctx.members.bea, "Thanks", question.id);

        expect(await ctx.repo().moderate(question.id, "handle", ctx.members.staff)).toBe("done");
        expect(await ctx.repo().moderate(question.id, "handle", ctx.members.staff)).toBe("no_change");
        expect(await ctx.repo().moderate(reply.id, "handle", ctx.members.staff)).toBe("no_change");

        expect(await ctx.repo().unansweredQuestions(ctx.courseId)).toEqual([]);
        expect((await ctx.repo().byId(question.id))?.handledAt).not.toBeNull();
      });

      it("deletes as staff once, and says not_found for a comment that is not there", async () => {
        const made = await post(ctx.lessons[0], ctx.members.ada, "Bad");

        expect(await ctx.repo().moderate(made.id, "delete", ctx.members.staff)).toBe("done");
        expect(await ctx.repo().moderate(made.id, "delete", ctx.members.staff)).toBe("no_change");
        expect(await ctx.repo().moderate("cmnt_ZZZZZZZZZZZZ", "delete", ctx.members.staff)).toBe("not_found");

        expect((await ctx.repo().byId(made.id))?.deletedAt).not.toBeNull();
        expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).entries).toEqual([]);
      });
    });

    describe("reports", () => {
      it("records one open report per reporter and comment, and lets another reporter add theirs", async () => {
        const made = await post(ctx.lessons[0], ctx.members.ada, "Reported words");

        expect(await ctx.repo().report({ commentId: made.id, reporterId: ctx.members.bea, reason: "Spam <b>" })).toBe("reported");
        expect(await ctx.repo().report({ commentId: made.id, reporterId: ctx.members.bea, reason: "Again" })).toBe("already_reported");
        expect(await ctx.repo().report({ commentId: made.id, reporterId: ctx.members.staff, reason: "Rude & loud" })).toBe("reported");
        expect(await ctx.repo().report({ commentId: "cmnt_ZZZZZZZZZZZZ", reporterId: ctx.members.bea, reason: "x" })).toBe("not_found");

        const [reported, ...rest] = await ctx.repo().openReports(ctx.courseId);
        expect(rest).toEqual([]);
        expect(reported).toMatchObject({ commentId: made.id, lessonId: ctx.lessons[0], lessonTitle: ctx.lessonTitles[0], body: "Reported words", reportCount: 2, state: "visible", isReply: false });
        expect([...reported.reasons].sort()).toEqual(["Rude & loud", "Spam <b>"]);
        // Reporters are never named.
        expect(JSON.stringify(reported)).not.toContain(ctx.members.bea);
      });

      it("holds a reason to 1 to 500 characters", async () => {
        const made = await post(ctx.lessons[0], ctx.members.ada, "Words");

        await expect(ctx.repo().report({ commentId: made.id, reporterId: ctx.members.bea, reason: "" })).rejects.toThrow();
        await expect(ctx.repo().report({ commentId: made.id, reporterId: ctx.members.bea, reason: "x".repeat(501) })).rejects.toThrow();
        await expect(ctx.repo().report({ commentId: made.id, reporterId: ctx.members.bea, reason: "x".repeat(500) })).resolves.toBe("reported");
      });

      it("lists the most reported first, then the oldest", async () => {
        const one = await post(ctx.lessons[0], ctx.members.ada, "One report");
        const two = await post(ctx.lessons[1], ctx.members.ada, "Two reports");
        await ctx.repo().report({ commentId: one.id, reporterId: ctx.members.bea, reason: "a" });
        await ctx.repo().report({ commentId: two.id, reporterId: ctx.members.bea, reason: "b" });
        await ctx.repo().report({ commentId: two.id, reporterId: ctx.members.staff, reason: "c" });

        expect((await ctx.repo().openReports(ctx.courseId)).map((r) => r.commentId)).toEqual([two.id, one.id]);
      });

      it("settles the reports when staff hide or delete the comment, and when they dismiss them", async () => {
        const hid = await post(ctx.lessons[0], ctx.members.ada, "Hide me");
        const del = await post(ctx.lessons[0], ctx.members.ada, "Delete me");
        const keep = await post(ctx.lessons[0], ctx.members.ada, "Fine really");
        for (const c of [hid, del, keep]) await ctx.repo().report({ commentId: c.id, reporterId: ctx.members.bea, reason: "r" });

        await ctx.repo().moderate(hid.id, "hide", ctx.members.staff);
        await ctx.repo().moderate(del.id, "delete", ctx.members.staff);
        expect((await ctx.repo().openReports(ctx.courseId)).map((r) => r.commentId)).toEqual([keep.id]);

        expect(await ctx.repo().moderate(keep.id, "dismiss", ctx.members.staff)).toBe("done");
        expect(await ctx.repo().moderate(keep.id, "dismiss", ctx.members.staff)).toBe("no_change");
        expect(await ctx.repo().openReports(ctx.courseId)).toEqual([]);
        // Dismissing leaves the comment as it was, and it can be reported again.
        expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).entries.map((e) => e.comment.id)).toContain(keep.id);
        expect(await ctx.repo().report({ commentId: keep.id, reporterId: ctx.members.bea, reason: "again" })).toBe("reported");
      });

      it("leaves out a comment its author deleted", async () => {
        const made = await post(ctx.lessons[0], ctx.members.ada, "Regretted");
        await ctx.repo().report({ commentId: made.id, reporterId: ctx.members.bea, reason: "r" });

        await ctx.repo().softDelete(made.id, ctx.members.ada, AT);

        expect(await ctx.repo().openReports(ctx.courseId)).toEqual([]);
      });

      it("reads reports and held comments past 1,000 rows", async () => {
        await ctx.bulkReported(ctx.lessons[0], ctx.members.ada, ctx.members.bea, 1050);
        await ctx.bulk(ctx.lessons[1], ctx.members.ada, 1050, true);

        expect(await ctx.repo().openReports(ctx.courseId)).toHaveLength(1050);
        expect(await ctx.repo().heldComments(ctx.courseId)).toHaveLength(1050);
      });
    });
    describe("following and reading", () => {
      it("follows when you post, never undoing a choice you already made", async () => {
        expect(await ctx.repo().isFollowing(ctx.members.ada, ctx.lessons[0])).toBe(false);
        await ctx.repo().ensureFollowing(ctx.members.ada, ctx.lessons[0]);
        expect(await ctx.repo().isFollowing(ctx.members.ada, ctx.lessons[0])).toBe(true);

        await ctx.repo().setFollowing(ctx.members.ada, ctx.lessons[0], false);
        await ctx.repo().ensureFollowing(ctx.members.ada, ctx.lessons[0]);
        expect(await ctx.repo().isFollowing(ctx.members.ada, ctx.lessons[0])).toBe(false);

        await ctx.repo().setFollowing(ctx.members.ada, ctx.lessons[0], true);
        expect(await ctx.repo().isFollowing(ctx.members.ada, ctx.lessons[0])).toBe(true);
        expect(await ctx.repo().isFollowing(ctx.members.ada, ctx.lessons[1])).toBe(false);
      });

      it("lists the followers of each lesson, leaving out those who stopped", async () => {
        await ctx.repo().setFollowing(ctx.members.ada, ctx.lessons[0], true);
        await ctx.repo().setFollowing(ctx.members.bea, ctx.lessons[0], true);
        await ctx.repo().setFollowing(ctx.members.staff, ctx.lessons[0], false);
        await ctx.repo().setFollowing(ctx.members.bea, ctx.lessons[1], true);

        const followers = await ctx.repo().followers(ctx.lessons);

        expect([...(followers.get(ctx.lessons[0]) ?? [])].sort()).toEqual([ctx.members.ada, ctx.members.bea].sort());
        expect(followers.get(ctx.lessons[1])).toEqual([ctx.members.bea]);
        expect((await ctx.repo().followers([])).size).toBe(0);
      });

      it("says when a member last opened the thread, null the first time", async () => {
        expect(await ctx.repo().markRead(ctx.members.ada, ctx.lessons[0], "2027-01-02T00:00:00.000Z")).toBeNull();
        const previous = await ctx.repo().markRead(ctx.members.ada, ctx.lessons[0], "2027-01-03T00:00:00.000Z");
        expect(new Date(previous as string).toISOString()).toBe("2027-01-02T00:00:00.000Z");
        // Another lesson and another member have their own marker.
        expect(await ctx.repo().markRead(ctx.members.ada, ctx.lessons[1], "2027-01-03T00:00:00.000Z")).toBeNull();
        expect(await ctx.repo().markRead(ctx.members.bea, ctx.lessons[0], "2027-01-03T00:00:00.000Z")).toBeNull();
      });
    });

    describe("imported comments", () => {
      const IMPORTED_AT = "2025-03-04T05:06:07.000Z";
      const imported = (lessonId: string, key: string, over: Record<string, unknown> = {}) => ({
        lessonId,
        sourceKey: `k-${key}`,
        parentId: null as string | null,
        authorName: `Pen Name ${key}`,
        body: `Imported ${key}`,
        createdAt: IMPORTED_AT,
        deletedAt: null as string | null,
        ...over,
      });

      /** The row written for a key (the database may return rows in any order). */
      const row = (written: { sourceKey: string; id: string }[], key: string) => written.find((w) => w.sourceKey === `k-${key}`)!;

      it("writes comments with no member, in their own time and name, and shows them in the thread as imported", async () => {
        const top = row(await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "a")]), "a");
        await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "b", { parentId: top.id, createdAt: "2025-03-05T05:06:07.000Z" })]);
        await post(ctx.lessons[0], ctx.members.ada, "Written in the Hub");

        const thread = await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea));

        expect(thread.count).toBe(3);
        const entry = thread.entries.find((e) => e.comment.id === top.id)!;
        expect(entry.comment).toMatchObject({ authorName: "Pen Name a", body: "Imported a", memberId: "", isStaffReply: false, imported: true, createdAt: IMPORTED_AT, held: false });
        expect(entry.replies.map((r) => ({ name: r.authorName, imported: r.imported }))).toEqual([{ name: "Pen Name b", imported: true }]);
        expect(thread.entries.find((e) => e.comment.body === "Written in the Hub")!.comment.imported).toBeUndefined();
        expect(new Date((await ctx.repo().byId(top.id))!.createdAt).toISOString()).toBe(IMPORTED_AT);
        expect(await ctx.repo().byId(top.id)).toMatchObject({ memberId: null, source: "kajabi", authorName: "Pen Name a", heldAt: null, isStaffReply: false });
      });

      it("writes the same comments again without duplicating, and brings the text up to date while leaving what staff did", async () => {
        const first = row(await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "a"), imported(ctx.lessons[0], "gone")]), "a");
        await ctx.repo().moderate(first.id, "hide", ctx.members.staff);

        const again = await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "a", { body: "Imported a, edited", authorName: "Renamed" }), imported(ctx.lessons[0], "gone", { deletedAt: AT })]);

        expect(again.find((w) => w.sourceKey === "k-a")!.id).toBe(first.id);
        const stored = await ctx.repo().importedOf("kajabi", [ctx.lessons[0]]);
        expect(stored).toHaveLength(2);
        expect(stored.find((c) => c.sourceKey === "k-a")).toMatchObject({ id: first.id, body: "Imported a, edited", authorName: "Renamed", deletedAt: null, deletedBy: null });
        expect(new Date(stored.find((c) => c.sourceKey === "k-gone")!.deletedAt!).toISOString()).toBe(AT);
        // Hidden by staff before the second write: still hidden, and the deleted one shows nowhere.
        expect((await ctx.repo().byId(first.id))?.hiddenAt).not.toBeNull();
        expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).count).toBe(0);
        expect((await ctx.repo().threadFor(ctx.lessons[0], staffView())).entries.map((e) => e.comment.id)).toEqual([first.id]);
      });

      it("reports only what was imported from the source asked for, and only on the lessons asked for", async () => {
        await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "a"), imported(ctx.lessons[1], "b")]);
        await post(ctx.lessons[0], ctx.members.ada, "Written in the Hub");

        expect((await ctx.repo().importedOf("kajabi", [ctx.lessons[0]])).map((c) => c.sourceKey)).toEqual(["k-a"]);
        expect(await ctx.repo().importedOf("other", ctx.lessons)).toEqual([]);
        expect(await ctx.repo().importedOf("kajabi", [])).toEqual([]);
      });

      it("is history: no unanswered question, no activity for a digest, and staff can still hide and delete it", async () => {
        const before = new Date(Date.now() - 1000).toISOString();
        const written = await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "q", { createdAt: new Date().toISOString() }), imported(ctx.lessons[0], "r")]);
        const question = row(written, "q");
        const other = row(written, "r");
        const after = new Date(Date.now() + 1000).toISOString();

        expect((await ctx.repo().unansweredQuestions(ctx.courseId)).map((q) => q.id)).not.toContain(question.id);
        expect((await ctx.repo().activityBetween(before, after)).map((a) => a.id)).not.toContain(question.id);
        expect(await ctx.repo().moderate(question.id, "hide", ctx.members.staff)).toBe("done");
        expect(await ctx.repo().moderate(other.id, "delete", ctx.members.staff)).toBe("done");
        expect((await ctx.repo().threadFor(ctx.lessons[0], as(ctx.members.bea))).count).toBe(0);
        expect((await ctx.repo().threadFor(ctx.lessons[0], staffView())).entries[0].comment).toMatchObject({ imported: true, hidden: true, authorName: "Pen Name q" });
      });

      it("names an imported author in the staff lists too, and refuses a reply under a reply or an empty name", async () => {
        const top = row(await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "a")]), "a");
        const reply = row(await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "b", { parentId: top.id })]), "b");
        await ctx.repo().report({ commentId: top.id, reporterId: ctx.members.bea, reason: "Off topic" });

        expect((await ctx.repo().openReports(ctx.courseId)).find((r) => r.commentId === top.id)).toMatchObject({ authorName: "Pen Name a", reportCount: 1 });
        await expect(ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "c", { parentId: reply.id })])).rejects.toThrow();
        await expect(ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "d", { authorName: "" })])).rejects.toThrow();
        await expect(ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "e", { body: "" })])).rejects.toThrow();
      });

      it("counts in a lesson's total for the outline, but is never an open question or new", async () => {
        await ctx.repo().markRead(ctx.members.ada, ctx.lessons[0], "2020-01-01T00:00:00.000Z");
        await ctx.repo().upsertImported("kajabi", [imported(ctx.lessons[0], "a", { createdAt: new Date().toISOString() })]);
        await post(ctx.lessons[0], ctx.members.bea, "A real question");

        const counts = (await ctx.repo().outlineCounts(ctx.courseId, ctx.members.ada)).get(ctx.lessons[0]);

        expect(counts).toEqual({ total: 2, unanswered: 1, newCount: 1 });
      });

      it("writes and reads past 1,000 comments", async () => {
        const rows = Array.from({ length: 1050 }, (_, i) => imported(ctx.lessons[1], `bulk-${i}`));

        const written = await ctx.repo().upsertImported("kajabi", rows);

        expect(written).toHaveLength(1050);
        expect(new Set(written.map((w) => w.id)).size).toBe(1050);
        expect(await ctx.repo().importedOf("kajabi", [ctx.lessons[1]])).toHaveLength(1050);
        expect(await ctx.repo().upsertImported("kajabi", [])).toEqual([]);
      });
    });

    describe("counts for the course outline", () => {
      it("counts live comments per lesson, the questions still waiting, and what is new since the viewer's last visit", async () => {
        await post(ctx.lessons[0], ctx.members.ada, "Waiting");
        const answered = await post(ctx.lessons[0], ctx.members.ada, "Answered");
        await post(ctx.lessons[0], ctx.members.staff, "Here you go", answered.id, true);
        const handled = await post(ctx.lessons[0], ctx.members.bea, "No answer needed");
        await ctx.repo().moderate(handled.id, "handle", ctx.members.staff);
        const hidden = await post(ctx.lessons[0], ctx.members.bea, "Hidden");
        await ctx.repo().moderate(hidden.id, "hide", ctx.members.staff);
        const deleted = await post(ctx.lessons[0], ctx.members.bea, "Deleted");
        await ctx.repo().softDelete(deleted.id, ctx.members.bea, AT);
        await ctx.repo().create({ lessonId: ctx.lessons[0], memberId: ctx.members.bea, parentId: null, body: "Held", isStaffReply: false, held: true });
        await post(ctx.lessons[1], ctx.members.bea, "Asked on the other lesson");
        await ctx.repo().markRead(ctx.members.ada, ctx.lessons[0], "2020-01-01T00:00:00.000Z");

        const counts = await ctx.repo().outlineCounts(ctx.courseId, ctx.members.ada);

        // Live: Waiting, Answered, its answer, No answer needed. Ada's own two are not new to her; the answer and the other are.
        expect(counts.get(ctx.lessons[0])).toEqual({ total: 4, unanswered: 1, newCount: 2 });
        // A lesson she never opened has nothing "new".
        expect(counts.get(ctx.lessons[1])).toEqual({ total: 1, unanswered: 1, newCount: 0 });
        await ctx.repo().softDelete((await post(ctx.lessons[1], ctx.members.ada, "Gone")).id, ctx.members.ada, AT);
        expect((await ctx.repo().outlineCounts(ctx.courseId, ctx.members.ada)).get(ctx.lessons[1])?.total).toBe(1);
      });

      it("has nothing for a course with no comments, and reads past 1,000 comments", async () => {
        expect((await ctx.repo().outlineCounts(ctx.courseId, ctx.members.ada)).size).toBe(0);
        await ctx.bulk(ctx.lessons[0], ctx.members.bea, 1050, false);

        expect((await ctx.repo().outlineCounts(ctx.courseId, ctx.members.ada)).get(ctx.lessons[0])).toMatchObject({ total: 1050, unanswered: 1050 });
      });
    });

    describe("what the notification senders read", () => {
      it("gives the live comments made in a window, with who and where but no text", async () => {
        const before = new Date(Date.now() - 1000).toISOString();
        const question = await post(ctx.lessons[0], ctx.members.ada, "A question");
        const answer = await post(ctx.lessons[0], ctx.members.staff, "An answer", question.id, true);
        const gone = await post(ctx.lessons[0], ctx.members.bea, "Deleted");
        const hidden = await post(ctx.lessons[1], ctx.members.bea, "Hidden");
        await ctx.repo().softDelete(gone.id, ctx.members.bea, AT);
        await ctx.repo().moderate(hidden.id, "hide", ctx.members.staff);
        await ctx.repo().create({ lessonId: ctx.lessons[1], memberId: ctx.members.ada, parentId: null, body: "Held", isStaffReply: false, held: true });
        const after = new Date(Date.now() + 1000).toISOString();

        const activity = (await ctx.repo().activityBetween(before, after)).filter((a) => ctx.lessons.includes(a.lessonId));

        expect(activity.map((a) => a.id)).toEqual([question.id, answer.id]);
        expect(activity[1]).toEqual({ id: answer.id, lessonId: ctx.lessons[0], memberId: ctx.members.staff, parentId: question.id, isStaffReply: true, createdAt: expect.any(String) });
        expect(JSON.stringify(activity)).not.toContain("A question");
        // Outside the window nothing shows.
        expect((await ctx.repo().activityBetween(after, new Date(Date.now() + 60_000).toISOString())).filter((a) => ctx.lessons.includes(a.lessonId))).toEqual([]);
      });

      it("names lessons with their course, and leaves out ones that are not there", async () => {
        const info = await ctx.repo().lessonInfo([ctx.lessons[0], ctx.lessons[1], "les_ZZZZZZZZZZZZ"]);

        expect(info.get(ctx.lessons[1])).toEqual({ lessonId: ctx.lessons[1], title: ctx.lessonTitles[1], courseId: ctx.courseId, courseTitle: ctx.course.title, courseSlug: ctx.course.slug });
        expect(info.has("les_ZZZZZZZZZZZZ")).toBe(false);
        expect((await ctx.repo().lessonInfo([])).size).toBe(0);
      });

      it("counts what waits for staff in the course: comments reported and comments held", async () => {
        const reported = await post(ctx.lessons[0], ctx.members.ada, "Reported twice");
        await ctx.repo().report({ commentId: reported.id, reporterId: ctx.members.bea, reason: "a" });
        await ctx.repo().report({ commentId: reported.id, reporterId: ctx.members.staff, reason: "b" });
        const settled = await post(ctx.lessons[0], ctx.members.ada, "Reported then hidden");
        await ctx.repo().report({ commentId: settled.id, reporterId: ctx.members.bea, reason: "c" });
        await ctx.repo().moderate(settled.id, "hide", ctx.members.staff);
        await ctx.repo().create({ lessonId: ctx.lessons[1], memberId: ctx.members.ada, parentId: null, body: "Held", isStaffReply: false, held: true });

        const here = (await ctx.repo().moderationBacklog()).find((c) => c.courseId === ctx.courseId);

        expect(here).toEqual({ courseId: ctx.courseId, courseTitle: ctx.course.title, reported: 1, held: 1 });
      });

      it("counts past 1,000 rows", async () => {
        await ctx.bulkReported(ctx.lessons[0], ctx.members.ada, ctx.members.bea, 1050);
        await ctx.bulk(ctx.lessons[1], ctx.members.ada, 1050, true);

        const here = (await ctx.repo().moderationBacklog()).find((c) => c.courseId === ctx.courseId);

        expect(here).toMatchObject({ reported: 1050, held: 1050 });
      });
    });
  });
}
