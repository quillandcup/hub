import { describe, it, expect, beforeEach } from "vitest";
import type { AdminWorkQueueRepository } from "@/lib/data/admin-work";

export type AdminWorkContractContext = {
  repo: () => AdminWorkQueueRepository;
  /** Two members: "Ada Example" and "Bo Example". */
  members: readonly { id: string }[];
  /** An auth user id (what `completed_by` and `user_id` point at). */
  userId: string;
  /** A row id nothing has. */
  missingId: string;
  /** A member id nothing has. */
  missingMemberId: string;
  /** A string unique to this run, put in group keys and feedback messages so rows can be told apart from other runs'. */
  run: string;
  /** Removes everything stored for the two members and the run's group keys. */
  clear: () => Promise<void>;
};

/** Behavior every `AdminWorkQueueRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineAdminWorkContract(name: string, setup: () => AdminWorkContractContext) {
  describe(`${name} (AdminWorkQueueRepository contract)`, () => {
    let ctx: AdminWorkContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo] = [0, 1];
    const id = (i: number) => ctx.members[i].id;

    describe("work queue", () => {
      it("records an item as handled, replaces that record when handled again, and lists the completions", async () => {
        const repo = ctx.repo();
        const done = await repo.complete({ queue_type: "welcome_back", member_id: id(ada), occurrence_key: "2026-01-10", status: "completed", completed_by: ctx.userId });
        expect(done).toMatchObject({ queue_type: "welcome_back", member_id: id(ada), occurrence_key: "2026-01-10", status: "completed", postponed_until: null, completed_by: ctx.userId });

        const postponed = await repo.complete({ queue_type: "hedgieversary", member_id: id(ada), occurrence_key: "2026-06-01", status: "postponed", postponed_until: "2026-07-01" });
        const again = await repo.complete({ queue_type: "welcome_back", member_id: id(ada), occurrence_key: "2026-01-10", status: "opted_out", completed_by: null });
        expect(again.id).toBe(done.id);
        expect(again).toMatchObject({ status: "opted_out", completed_by: null });
        expect(postponed).toMatchObject({ status: "postponed", postponed_until: "2026-07-01" });

        const ours = (await repo.completions()).filter((c) => c.member_id === id(ada));
        expect(ours).toHaveLength(2);
        expect(ours.find((c) => c.queue_type === "welcome_back")).toEqual({ queue_type: "welcome_back", member_id: id(ada), occurrence_key: "2026-01-10", status: "opted_out", postponed_until: null });
        expect(ours.find((c) => c.queue_type === "hedgieversary")).toMatchObject({ postponed_until: "2026-07-01" });
        expect(Object.keys(ours[0]).sort()).toEqual(["member_id", "occurrence_key", "postponed_until", "queue_type", "status"]);
      });

      it("undoes a completion, and ignores one that is not there", async () => {
        const repo = ctx.repo();
        const done = await repo.complete({ queue_type: "big_sister", member_id: id(bo), occurrence_key: "k", status: "completed" });
        await repo.undoCompletion(done.id);
        await repo.undoCompletion(done.id);
        await repo.undoCompletion(ctx.missingId);
        expect((await repo.completions()).filter((c) => c.member_id === id(bo))).toEqual([]);
      });

      it("refuses a completion for a member that does not exist", async () => {
        await expect(ctx.repo().complete({ queue_type: "welcome_back", member_id: ctx.missingMemberId, occurrence_key: "k", status: "completed" })).rejects.toThrow();
      });
    });

    describe("duplicate groups", () => {
      it("dismisses groups (twice is fine) and brings them back", async () => {
        const repo = ctx.repo();
        const [a, b] = [`dup-${ctx.run}-a`, `dup-${ctx.run}-b`];
        expect((await repo.dismissedGroupKeys()).has(a)).toBe(false);

        await repo.dismissGroup(a);
        await repo.dismissGroup(a);
        await repo.dismissGroup(b);
        const keys = await repo.dismissedGroupKeys();
        expect([keys.has(a), keys.has(b)]).toEqual([true, true]);

        await repo.restoreGroup(a);
        await repo.restoreGroup(a);
        const after = await repo.dismissedGroupKeys();
        expect([after.has(a), after.has(b)]).toEqual([false, true]);
      });
    });

    describe("feedback", () => {
      const submit = (n: number, extra: { member?: number; type?: string } = {}) =>
        ctx.repo().addFeedback({
          user_id: ctx.userId,
          member_id: extra.member === undefined ? null : id(extra.member),
          page_url: `/somewhere/${n}`,
          feedback_type: extra.type ?? "bug",
          message: `Feedback ${n} ${ctx.run}`,
        });
      const ours = async (options: { status?: string } = {}) => {
        const { rows, total } = await ctx.repo().feedbackPage({ ...options, page: 0, pageSize: 100 });
        return { rows: rows.filter((r) => r.message.endsWith(ctx.run)), total };
      };

      it("saves a submission with its defaults, and gives it back", async () => {
        const saved = await submit(1, { member: ada });
        expect(saved).toMatchObject({ user_id: ctx.userId, member_id: id(ada), is_sudo: false, page_url: "/somewhere/1", feedback_type: "bug", status: "new", admin_notes: null, screenshot_path: null, user_agent: null });
        expect(saved.id).toEqual(expect.any(String));
        const withId = await ctx.repo().addFeedback({ id: crypto.randomUUID(), user_id: ctx.userId, page_url: "/p", feedback_type: "idea", message: `Own id ${ctx.run}`, is_sudo: true, screenshot_path: "a/b.png", user_agent: "test" });
        expect(withId).toMatchObject({ member_id: null, is_sudo: true, screenshot_path: "a/b.png", user_agent: "test" });
      });

      it("pages feedback newest first with the sender, filtered by status, and counts what matches", async () => {
        await submit(1, { member: ada });
        await submit(2);
        const third = await submit(3, { member: bo });
        await ctx.repo().updateFeedback(third.id, { status: "resolved" });

        const all = await ours();
        expect(all.rows.map((r) => r.message)).toEqual([`Feedback 3 ${ctx.run}`, `Feedback 2 ${ctx.run}`, `Feedback 1 ${ctx.run}`]);
        expect(all.total).toBeGreaterThanOrEqual(3);
        const byMessage = new Map(all.rows.map((r) => [r.message, r]));
        expect(byMessage.get(`Feedback 1 ${ctx.run}`)?.member).toMatchObject({ name: expect.stringContaining("Ada Example"), display_name: "Ada E." });
        expect(byMessage.get(`Feedback 2 ${ctx.run}`)?.member).toBeNull();
        expect(byMessage.get(`Feedback 3 ${ctx.run}`)?.member).toMatchObject({ display_name: null });

        const resolved = await ours({ status: "resolved" });
        expect(resolved.rows.map((r) => r.id)).toEqual([third.id]);
        expect(resolved.total).toBeGreaterThanOrEqual(1);
        expect((await ours({ status: "wontfix" })).rows).toEqual([]);

        const pageOfOne = await ctx.repo().feedbackPage({ status: "resolved", page: 0, pageSize: 1 });
        expect(pageOfOne.rows).toHaveLength(1);
        expect(pageOfOne.total).toBeGreaterThanOrEqual(1);
      });

      it("changes a submission's status and notes, and ignores one that is not there", async () => {
        const saved = await submit(1);
        await ctx.repo().updateFeedback(saved.id, { status: "acknowledged" });
        await ctx.repo().updateFeedback(saved.id, { admin_notes: "On it" });
        await ctx.repo().updateFeedback(ctx.missingId, { status: "wontfix" });
        expect((await ours()).rows[0]).toMatchObject({ id: saved.id, status: "acknowledged", admin_notes: "On it" });
      });

    });
  });
}
