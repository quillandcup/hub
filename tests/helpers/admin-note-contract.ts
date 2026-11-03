import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MAX_ADMIN_NOTE_LENGTH, type AdminNoteRepository } from "@/lib/data/admin-notes";

export type AdminNoteContractContext = {
  repo: () => AdminNoteRepository;
  /** Two members. */
  members: readonly [string, string];
  /** An auth user id (what `created_by` points at). */
  userId: string;
  /** A member id nothing has. */
  missingMemberId: string;
  /**
   * A repository that runs `edit` as this auth user (`userId` for the author, another id for someone else).
   * Only where the caller can be chosen: the real database tells `edit` apart through the signed-in user's
   * JWT, which supabase/tests/database/member_admin_notes.test.sql covers, so that run leaves this out.
   */
  editAs?: (userId: string) => AdminNoteRepository;
  /** Removes every note stored for the two members. */
  clear: () => Promise<void>;
};

/** Behavior every `AdminNoteRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineAdminNoteContract(name: string, setup: () => AdminNoteContractContext) {
  describe(`${name} (AdminNoteRepository contract)`, () => {
    let ctx: AdminNoteContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    it("adds a trimmed, timestamped note and lists it", async () => {
      const repo = ctx.repo();
      const note = await repo.add(ctx.members[0], "  Sent an Instagram DM  ", ctx.userId);
      expect(note).toMatchObject({ memberId: ctx.members[0], body: "Sent an Instagram DM", createdBy: ctx.userId });
      expect(note.id).toMatch(/^mnote_/);
      expect(Number.isNaN(Date.parse(note.createdAt))).toBe(false);
      expect(await repo.list(ctx.members[0])).toEqual([note]);
    });

    it("lists newest first, and only the member's own notes", async () => {
      const repo = ctx.repo();
      const first = await repo.add(ctx.members[0], "first", null);
      await new Promise((r) => setTimeout(r, 5));
      const second = await repo.add(ctx.members[0], "second", null);
      await repo.add(ctx.members[1], "someone else", null);
      expect((await repo.list(ctx.members[0])).map((n) => n.id)).toEqual([second.id, first.id]);
      expect((await repo.list(ctx.members[1])).map((n) => n.body)).toEqual(["someone else"]);
    });

    it("soft deletes a note: gone from the list, and a second delete finds nothing", async () => {
      const repo = ctx.repo();
      const keep = await repo.add(ctx.members[0], "keep", null);
      const drop = await repo.add(ctx.members[0], "drop", null);
      expect(await repo.remove(ctx.members[0], drop.id)).toBe(true);
      expect((await repo.list(ctx.members[0])).map((n) => n.id)).toEqual([keep.id]);
      expect(await repo.remove(ctx.members[0], drop.id)).toBe(false);
    });

    it("won't delete a note through another member's page", async () => {
      const repo = ctx.repo();
      const note = await repo.add(ctx.members[0], "mine", null);
      expect(await repo.remove(ctx.members[1], note.id)).toBe(false);
      expect(await repo.list(ctx.members[0])).toHaveLength(1);
    });

    it("refuses blank or over-long text and a member that does not exist", async () => {
      const repo = ctx.repo();
      await expect(repo.add(ctx.members[0], "   ", null)).rejects.toThrow();
      await expect(repo.add(ctx.members[0], "x".repeat(MAX_ADMIN_NOTE_LENGTH + 1), null)).rejects.toThrow();
      await expect(repo.add(ctx.missingMemberId, "hello", null)).rejects.toThrow();
      expect(await repo.list(ctx.members[0])).toEqual([]);
    });

    describe("edit", () => {
      afterEach(() => vi.useRealTimers());
      const other = "00000000-0000-4000-8000-0000000000ff";

      it("lets the author correct a note inside the window, and marks it edited", async (t) => {
        if (!ctx.editAs) return t.skip();
        const note = await ctx.repo().add(ctx.members[0], "Sent an Instgram DM", ctx.userId);
        expect(await ctx.editAs(ctx.userId).edit(note.id, "  Sent an Instagram DM ", 15)).toBe(true);
        const [edited] = await ctx.repo().list(ctx.members[0]);
        expect(edited).toMatchObject({ id: note.id, body: "Sent an Instagram DM", createdAt: note.createdAt });
        expect(edited.editedAt).not.toBeNull();
      });

      it("refuses anyone but the author", async (t) => {
        if (!ctx.editAs) return t.skip();
        const note = await ctx.repo().add(ctx.members[0], "mine", ctx.userId);
        expect(await ctx.editAs(other).edit(note.id, "hijacked", 15)).toBe(false);
        expect((await ctx.repo().list(ctx.members[0]))[0]).toMatchObject({ body: "mine", editedAt: null });
      });

      it("refuses once the window has passed, and for a deleted note", async (t) => {
        if (!ctx.editAs) return t.skip();
        vi.useFakeTimers({ toFake: ["Date"] });
        const note = await ctx.repo().add(ctx.members[0], "old", ctx.userId);
        const gone = await ctx.repo().add(ctx.members[0], "gone", ctx.userId);
        await ctx.repo().remove(ctx.members[0], gone.id);
        expect(await ctx.editAs(ctx.userId).edit(gone.id, "back", 15)).toBe(false);
        vi.setSystemTime(Date.now() + 16 * 60_000);
        expect(await ctx.editAs(ctx.userId).edit(note.id, "late", 15)).toBe(false);
        vi.setSystemTime(Date.now() - 10 * 60_000);
        expect(await ctx.editAs(ctx.userId).edit(note.id, "in time", 15)).toBe(true);
      });

      it("refuses blank text and a non-positive window", async (t) => {
        if (!ctx.editAs) return t.skip();
        const note = await ctx.repo().add(ctx.members[0], "keep", ctx.userId);
        await expect(ctx.editAs(ctx.userId).edit(note.id, "  ", 15)).rejects.toThrow();
        await expect(ctx.editAs(ctx.userId).edit(note.id, "x", 0)).rejects.toThrow();
        expect((await ctx.repo().list(ctx.members[0]))[0].body).toBe("keep");
      });
    });
  });
}
