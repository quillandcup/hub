import { describe, it, expect } from "vitest";
import { AcknowledgementConflict, type BillingAcknowledgementRepository, type NewAcknowledgement } from "@/lib/data/billing-acknowledgements";

export type BillingAcknowledgementContractContext = {
  repo: () => BillingAcknowledgementRepository;
  /** Two members that exist. */
  members: [string, string];
  /** A person who can be recorded as having acknowledged or revoked (an auth user id). */
  staff: string;
  /** Row keys are unique to this run, so rows left behind by an earlier run (nothing deletes an acknowledgement) never meet these. */
  keyPrefix: string;
};

/** Behavior every `BillingAcknowledgementRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineBillingAcknowledgementContract(name: string, setup: () => BillingAcknowledgementContractContext) {
  describe(`${name} (BillingAcknowledgementRepository contract)`, () => {
    const input = (ctx: BillingAcknowledgementContractContext, suffix: string, extra: Partial<NewAcknowledgement> = {}): NewAcknowledgement => ({
      rowKey: `${ctx.keyPrefix}:${suffix}`,
      memberId: ctx.members[0],
      purchaseType: "event",
      reason: "comp",
      note: "Seed launch",
      statusAtAck: "missing_payment",
      amountCentsAtAck: 69700,
      acknowledgedBy: ctx.staff,
      ...extra,
    });
    const mine = async (ctx: BillingAcknowledgementContractContext) => (await ctx.repo().active()).filter((r) => r.rowKey.startsWith(`${ctx.keyPrefix}:`));

    it("has no acknowledgement until one is added, then returns it as it was recorded", async () => {
      const ctx = setup();
      const a = input(ctx, "first");
      expect(await ctx.repo().activeFor(a.rowKey)).toBeNull();
      await ctx.repo().add(a);
      expect(await ctx.repo().activeFor(a.rowKey)).toMatchObject({
        rowKey: a.rowKey,
        memberId: a.memberId,
        purchaseType: "event",
        reason: "comp",
        note: "Seed launch",
        statusAtAck: "missing_payment",
        amountCentsAtAck: 69700,
        acknowledgedBy: ctx.staff,
        revokedAt: null,
        revokedBy: null,
      });
    });

    it("keeps a missing amount and note as none", async () => {
      const ctx = setup();
      const a = input(ctx, "bare", { memberId: ctx.members[1], purchaseType: "membership", reason: "gift", note: null, amountCentsAtAck: null });
      await ctx.repo().add(a);
      expect(await ctx.repo().activeFor(a.rowKey)).toMatchObject({ purchaseType: "membership", reason: "gift", note: null, amountCentsAtAck: null });
    });

    it("lists the active acknowledgements in row key order", async () => {
      const ctx = setup();
      await ctx.repo().add(input(ctx, "list-b"));
      await ctx.repo().add(input(ctx, "list-a", { memberId: ctx.members[1] }));
      const keys = (await mine(ctx)).map((r) => r.rowKey).filter((k) => k.includes(":list-"));
      expect(keys).toEqual([`${ctx.keyPrefix}:list-a`, `${ctx.keyPrefix}:list-b`]);
    });

    it("allows one active acknowledgement per row", async () => {
      const ctx = setup();
      const a = input(ctx, "once");
      await ctx.repo().add(a);
      await expect(ctx.repo().add({ ...a, reason: "gift" })).rejects.toBeInstanceOf(AcknowledgementConflict);
      expect(await ctx.repo().activeFor(a.rowKey)).toMatchObject({ reason: "comp" });
    });

    it("revokes once, keeps who and when, drops it from the active list, and lets the row be marked again", async () => {
      const ctx = setup();
      const a = input(ctx, "undo");
      await ctx.repo().add(a);
      expect(await ctx.repo().revoke(a.rowKey, ctx.staff)).toBe(true);
      expect(await ctx.repo().activeFor(a.rowKey)).toBeNull();
      expect((await mine(ctx)).some((r) => r.rowKey === a.rowKey)).toBe(false);
      expect(await ctx.repo().revoke(a.rowKey, ctx.staff)).toBe(false);

      await ctx.repo().add({ ...a, reason: "forfeited", note: null });
      expect(await ctx.repo().activeFor(a.rowKey)).toMatchObject({ reason: "forfeited", revokedAt: null });
    });

    it("has nothing to revoke for a row never marked", async () => {
      const ctx = setup();
      expect(await ctx.repo().revoke(`${ctx.keyPrefix}:never`, ctx.staff)).toBe(false);
    });

    it("refuses reason other without a note, and a member that does not exist", async () => {
      const ctx = setup();
      await expect(ctx.repo().add(input(ctx, "other", { reason: "other", note: null }))).rejects.toThrow();
      await expect(ctx.repo().add(input(ctx, "ghost", { memberId: "mbr_ZZZZZZZZZZZZ" }))).rejects.toThrow();
      expect(await ctx.repo().activeFor(`${ctx.keyPrefix}:other`)).toBeNull();
    });
  });
}
