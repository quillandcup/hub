import { describe, it, expect, beforeEach } from "vitest";
import type { ConversationRepository } from "@/lib/data/conversations";

export type ConversationContractContext = {
  repo: () => ConversationRepository;
  /** Three members: "Ada Example" (display name "Ada E."), "Bo Example" and "Cy Example". */
  members: readonly { id: string; name: string }[];
  /** The staff account that opens conversations (an auth user id), or null for none. */
  openedBy: string | null;
  /** A conversation id nothing has. */
  missingId: string;
  /** Removes every conversation of the three members. */
  clear: () => Promise<void>;
};

/** A stored instant as an ISO string: Postgres answers "+00:00", the twin keeps what it was given. */
const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

/** Behavior every `ConversationRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineConversationContract(name: string, setup: () => ConversationContractContext) {
  describe(`${name} (ConversationRepository contract)`, () => {
    let ctx: ConversationContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo, cy] = [0, 1, 2];
    const id = (i: number) => ctx.members[i].id;
    const open = (member: number, over: Partial<Parameters<ConversationRepository["open"]>[0]> = {}) =>
      ctx.repo().open({ memberId: id(member), reason: "check_in", channel: "slack_dm", openedBy: ctx.openedBy, openedAt: "2026-03-01T15:00:00.000Z", ...over });
    const opened = async (member: number, over: Partial<Parameters<ConversationRepository["open"]>[0]> = {}) => {
      const result = await open(member, over);
      if (!result.ok) throw new Error("expected the conversation to open");
      return result.conversation;
    };

    describe("opening", () => {
      it("opens a conversation she started: open, with her message at the start", async () => {
        const c = await opened(ada, { notes: "said hello", nextStep: "ask about the draft", followUpOn: "2026-03-08" });

        expect(c).toMatchObject({
          member_id: id(ada),
          reason: "check_in",
          channel: "slack_dm",
          opened_by: ctx.openedBy,
          closed_at: null,
          outcome: null,
          last_member_message_at: null,
          notes: "said hello",
          next_step: "ask about the draft",
          follow_up_on: "2026-03-08",
          deleted_at: null,
        });
        expect(iso(c.last_staff_message_at)).toBe("2026-03-01T15:00:00.000Z");
        expect(c.id).toMatch(/^conv_[1-9A-HJ-NP-Za-km-z]{12}$/);
      });

      it("opens one the member started: their message at the start, not hers", async () => {
        const c = await opened(bo, { firstMessageFrom: "member" });

        expect(iso(c.last_member_message_at)).toBe("2026-03-01T15:00:00.000Z");
        expect(c.last_staff_message_at).toBeNull();
      });

      it("keeps one open conversation per member and channel, and answers with the one that is open", async () => {
        const first = await opened(ada);

        const again = await open(ada, { reason: "hello" });
        expect(again).toMatchObject({ ok: false, reason: "already_open" });
        if (again.ok) throw new Error("unreachable");
        expect(again.conversation.id).toBe(first.id);
        expect(again.conversation.reason).toBe("check_in");
        expect(await ctx.repo().forMember(id(ada))).toHaveLength(1);
      });

      it("lets the same member have one on another channel, and another member one on the same channel", async () => {
        await opened(ada);
        expect((await open(ada, { channel: "email" })).ok).toBe(true);
        expect((await open(bo)).ok).toBe(true);
      });

      it("lets a new one open once the old one is closed or removed", async () => {
        const first = await opened(ada);
        await ctx.repo().close(first.id, "no_response", "2026-03-10T12:00:00.000Z");
        const second = await opened(ada);
        await ctx.repo().softDelete(second.id, "2026-03-11T12:00:00.000Z");

        expect((await open(ada)).ok).toBe(true);
      });

      it("refuses a reason or channel outside the sets, text over the limits and a member nobody has", async () => {
        await expect(open(ada, { reason: "gossip" })).rejects.toThrow();
        await expect(open(ada, { channel: "carrier_pigeon" })).rejects.toThrow();
        await expect(open(ada, { notes: "x".repeat(1001) })).rejects.toThrow();
        await expect(open(ada, { nextStep: "x".repeat(281) })).rejects.toThrow();
        await expect(open(ada, { memberId: "mbr_ZZZZZZZZZZZZ" })).rejects.toThrow();
        expect(await ctx.repo().forMember(id(ada))).toEqual([]);
      });
    });

    describe("logging messages", () => {
      it("sets who spoke last on an open conversation", async () => {
        const c = await opened(ada);

        const afterMember = await ctx.repo().logMessage(c.id, "member", "2026-03-02T10:00:00.000Z");
        expect([iso(afterMember!.last_member_message_at), iso(afterMember!.last_staff_message_at)]).toEqual(["2026-03-02T10:00:00.000Z", "2026-03-01T15:00:00.000Z"]);

        const afterStaff = await ctx.repo().logMessage(c.id, "staff", "2026-03-03T10:00:00.000Z");
        expect([iso(afterStaff!.last_member_message_at), iso(afterStaff!.last_staff_message_at)]).toEqual(["2026-03-02T10:00:00.000Z", "2026-03-03T10:00:00.000Z"]);
      });

      it("answers null for a closed conversation, a removed one or one nobody has", async () => {
        const closed = await opened(ada);
        await ctx.repo().close(closed.id, "resolved", "2026-03-04T10:00:00.000Z");
        const removed = await opened(bo);
        await ctx.repo().softDelete(removed.id, "2026-03-04T10:00:00.000Z");

        expect(await ctx.repo().logMessage(closed.id, "member", "2026-03-05T10:00:00.000Z")).toBeNull();
        expect(await ctx.repo().logMessage(removed.id, "member", "2026-03-05T10:00:00.000Z")).toBeNull();
        expect(await ctx.repo().logMessage(ctx.missingId, "member", "2026-03-05T10:00:00.000Z")).toBeNull();
      });
    });

    describe("updating", () => {
      it("changes only what is given, and clears a field given null", async () => {
        const c = await opened(ada, { notes: "first", nextStep: "write back", followUpOn: "2026-03-08" });

        const edited = await ctx.repo().update(c.id, { notes: "second", followUpOn: null });
        expect(edited).toMatchObject({ notes: "second", next_step: "write back", follow_up_on: null, reason: "check_in" });

        const reasoned = await ctx.repo().update(c.id, { reason: "encouragement" });
        expect(reasoned).toMatchObject({ reason: "encouragement", notes: "second" });
      });

      it("returns the conversation as it is when there is nothing to change", async () => {
        const c = await opened(ada, { notes: "kept" });
        expect(await ctx.repo().update(c.id, {})).toMatchObject({ id: c.id, notes: "kept" });
      });

      it("answers null for one nobody has or that was removed, and refuses a bad reason or long text", async () => {
        const c = await opened(ada);
        expect(await ctx.repo().update(ctx.missingId, { notes: "x" })).toBeNull();

        await expect(ctx.repo().update(c.id, { reason: "gossip" })).rejects.toThrow();
        await expect(ctx.repo().update(c.id, { notes: "x".repeat(1001) })).rejects.toThrow();

        await ctx.repo().softDelete(c.id, "2026-03-04T10:00:00.000Z");
        expect(await ctx.repo().update(c.id, { notes: "x" })).toBeNull();
      });
    });

    describe("closing and removing", () => {
      it("closes an open conversation with its outcome, once", async () => {
        const c = await opened(ada);

        const closed = await ctx.repo().close(c.id, "re_engaged", "2026-03-09T09:00:00.000Z");
        expect(closed).toMatchObject({ id: c.id, outcome: "re_engaged" });
        expect(iso(closed!.closed_at)).toBe("2026-03-09T09:00:00.000Z");

        expect(await ctx.repo().close(c.id, "declined", "2026-03-10T09:00:00.000Z")).toBeNull();
        expect(await ctx.repo().close(ctx.missingId, "declined", "2026-03-10T09:00:00.000Z")).toBeNull();
        expect((await ctx.repo().byId(c.id))?.outcome).toBe("re_engaged");
      });

      it("refuses an outcome outside the set and leaves it open", async () => {
        const c = await opened(ada);
        await expect(ctx.repo().close(c.id, "vanished", "2026-03-09T09:00:00.000Z")).rejects.toThrow();
        expect((await ctx.repo().byId(c.id))?.closed_at).toBeNull();
      });

      it("removes a conversation from every read, and says so when there was none", async () => {
        const c = await opened(ada);

        expect(await ctx.repo().softDelete(c.id, "2026-03-04T10:00:00.000Z")).toBe(true);
        expect(await ctx.repo().softDelete(c.id, "2026-03-05T10:00:00.000Z")).toBe(false);
        expect(await ctx.repo().softDelete(ctx.missingId, "2026-03-05T10:00:00.000Z")).toBe(false);

        expect(await ctx.repo().byId(c.id)).toBeNull();
        expect(await ctx.repo().forMember(id(ada))).toEqual([]);
        expect((await ctx.repo().list({ closedSince: "2000-01-01T00:00:00.000Z" })).filter((x) => x.id === c.id)).toEqual([]);
      });
    });

    describe("reading", () => {
      it("lists every open conversation and those closed since, newest opened first, with the member joined in", async () => {
        const oldOpen = await opened(ada, { openedAt: "2026-01-05T12:00:00.000Z" });
        const newOpen = await opened(bo, { openedAt: "2026-03-05T12:00:00.000Z" });
        const recentClosed = await opened(cy, { openedAt: "2026-02-20T12:00:00.000Z" });
        await ctx.repo().close(recentClosed.id, "resolved", "2026-03-01T12:00:00.000Z");
        const longClosed = await opened(cy, { openedAt: "2025-12-01T12:00:00.000Z", channel: "email" });
        await ctx.repo().close(longClosed.id, "no_response", "2025-12-20T12:00:00.000Z");

        const mine = new Set([oldOpen.id, newOpen.id, recentClosed.id, longClosed.id]);
        const listed = (await ctx.repo().list({ closedSince: "2026-02-01T00:00:00.000Z" })).filter((c) => mine.has(c.id));

        expect(listed.map((c) => c.id)).toEqual([newOpen.id, recentClosed.id, oldOpen.id]);
        expect(listed[2].member).toEqual({ id: id(ada), name: ctx.members[ada].name, display_name: "Ada E." });
        expect(listed[0].member).toEqual({ id: id(bo), name: ctx.members[bo].name, display_name: null });
      });

      it("lists only the open ones when nothing is said about closed ones", async () => {
        const open1 = await opened(ada);
        const closed = await opened(bo);
        await ctx.repo().close(closed.id, "resolved", "2026-03-01T12:00:00.000Z");

        const ids = (await ctx.repo().list()).map((c) => c.id);
        expect(ids).toContain(open1.id);
        expect(ids).not.toContain(closed.id);
      });

      it("finds one by id with its member, and one member's conversations newest first", async () => {
        const first = await opened(ada, { openedAt: "2026-01-05T12:00:00.000Z" });
        await ctx.repo().close(first.id, "resolved", "2026-01-20T12:00:00.000Z");
        const second = await opened(ada, { openedAt: "2026-03-05T12:00:00.000Z" });
        await opened(bo);

        expect((await ctx.repo().byId(second.id))?.member).toMatchObject({ id: id(ada), display_name: "Ada E." });
        expect(await ctx.repo().byId(ctx.missingId)).toBeNull();
        expect((await ctx.repo().forMember(id(ada))).map((c) => c.id)).toEqual([second.id, first.id]);
      });
    });
  });
}
