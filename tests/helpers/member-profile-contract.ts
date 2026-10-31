import { describe, it, expect, beforeEach } from "vitest";
import type { MemberProfileRepository } from "@/lib/data/member-profile";

export type MemberProfileContractContext = {
  repo: () => MemberProfileRepository;
  /** Three members: "Ada Example", "Bo Example" and "Cy Example". */
  members: readonly { id: string }[];
  /** An auth user id (what `updated_by` points at). */
  userId: string;
  /** A member id nothing has. */
  missingMemberId: string;
  /** Stores a Slack connection (the app writes them through a database function that keeps the tokens in the vault). */
  seedSlackConnection: (memberId: string, slackUserId: string, options?: { revoked?: boolean; scopes?: string[] }) => Promise<void>;
  /** Removes everything stored for the three members. */
  clear: () => Promise<void>;
};

/** Behavior every `MemberProfileRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMemberProfileContract(name: string, setup: () => MemberProfileContractContext) {
  describe(`${name} (MemberProfileRepository contract)`, () => {
    let ctx: MemberProfileContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo, cy] = [0, 1, 2];
    const id = (i: number) => ctx.members[i].id;

    describe("ask me about", () => {
      it("has no topics until saved, keeps their order, and replaces them", async () => {
        const repo = ctx.repo();
        expect(await repo.askMeAbout(id(ada))).toEqual([]);

        await repo.saveAskMeAbout(id(ada), ["Plotting", "Poetry", "Cats"], ctx.userId);
        expect(await repo.askMeAbout(id(ada))).toEqual(["Plotting", "Poetry", "Cats"]);
        expect(await repo.askMeAbout(id(bo))).toEqual([]);

        await repo.saveAskMeAbout(id(ada), ["Cats"], ctx.userId);
        expect(await repo.askMeAbout(id(ada))).toEqual(["Cats"]);
        await repo.saveAskMeAbout(id(ada), [], ctx.userId);
        expect(await repo.askMeAbout(id(ada))).toEqual([]);
      });

      it("refuses topics for a member that does not exist", async () => {
        await expect(ctx.repo().saveAskMeAbout(ctx.missingMemberId, ["x"], ctx.userId)).rejects.toThrow();
      });
    });

    describe("private notes", () => {
      it("saves a note, finds it for its author only, and replaces it", async () => {
        const repo = ctx.repo();
        expect(await repo.noteAbout(id(ada), id(bo))).toBeNull();

        const savedAt = await repo.saveNote(id(ada), id(bo), "Loves sonnets");
        expect(savedAt).toEqual(expect.any(String));
        expect(await repo.noteAbout(id(ada), id(bo))).toEqual({ body: "Loves sonnets", updated_at: savedAt });
        expect(await repo.noteAbout(id(bo), id(ada))).toBeNull();
        expect(await repo.noteAbout(id(cy), id(bo))).toBeNull();

        await repo.saveNote(id(ada), id(bo), "Loves sonnets and limericks");
        expect((await repo.noteAbout(id(ada), id(bo)))?.body).toBe("Loves sonnets and limericks");
      });

      it("lists the notes an author wrote by subject, and deletes one", async () => {
        const repo = ctx.repo();
        await repo.saveNote(id(ada), id(bo), "About Bo");
        await repo.saveNote(id(ada), id(cy), "About Cy");
        await repo.saveNote(id(bo), id(ada), "About Ada");

        expect(await repo.notesBy(id(ada))).toEqual(
          new Map([
            [id(bo), "About Bo"],
            [id(cy), "About Cy"],
          ]),
        );
        expect(await repo.notesBy(id(cy))).toEqual(new Map());

        await repo.deleteNote(id(ada), id(bo));
        await repo.deleteNote(id(ada), id(bo)); // already gone
        expect(await repo.notesBy(id(ada))).toEqual(new Map([[id(cy), "About Cy"]]));
        expect((await repo.notesBy(id(bo))).get(id(ada))).toBe("About Ada");
      });

      it("refuses a note about a member that does not exist", async () => {
        await expect(ctx.repo().saveNote(id(ada), ctx.missingMemberId, "x")).rejects.toThrow();
      });
    });

    describe("roster", () => {
      it("hides and shows members, and answers for a list of any length", async () => {
        const repo = ctx.repo();
        expect(await repo.rosterOptOuts([])).toEqual(new Set());
        expect(await repo.rosterOptOuts([id(ada), id(bo)])).toEqual(new Set());

        await repo.setRosterVisible(id(ada), false);
        await repo.setRosterVisible(id(ada), false); // hiding twice is fine
        await repo.setRosterVisible(id(bo), false);
        expect(await repo.rosterOptOuts([id(ada), id(bo), id(cy)])).toEqual(new Set([id(ada), id(bo)]));

        await repo.setRosterVisible(id(ada), true);
        await repo.setRosterVisible(id(cy), true); // never hidden
        expect(await repo.rosterOptOuts([id(ada), id(bo), id(cy)])).toEqual(new Set([id(bo)]));

        // More ids than fit one request (ids are chunked), including duplicates.
        const many = [id(bo), id(bo), ...Array.from({ length: 250 }, (_, i) => `mbr_Z${String(i).padStart(11, "Z")}`)];
        expect(await repo.rosterOptOuts(many)).toEqual(new Set([id(bo)]));
      });

      it("refuses to hide a member that does not exist", async () => {
        await expect(ctx.repo().setRosterVisible(ctx.missingMemberId, false)).rejects.toThrow();
      });
    });

    describe("Getting started tour", () => {
      it("has no state until saved, then keeps what was saved and changes only the given fields", async () => {
        const repo = ctx.repo();
        expect(await repo.onboardingOf(id(ada))).toBeNull();

        await repo.saveOnboarding(id(ada), { marked_steps: ["names"] });
        expect(await repo.onboardingOf(id(ada))).toEqual({ marked_steps: ["names"], dismissed_at: null, completed_at: null, acknowledged_steps: null });

        await repo.saveOnboarding(id(ada), { dismissed_at: "2026-02-01T10:00:00+00:00" });
        const dismissed = await repo.onboardingOf(id(ada));
        expect(dismissed?.marked_steps).toEqual(["names"]);
        expect(new Date(dismissed!.dismissed_at!).toISOString()).toBe("2026-02-01T10:00:00.000Z");

        await repo.saveOnboarding(id(ada), { marked_steps: [], dismissed_at: null, completed_at: null, acknowledged_steps: ["a", "b"] });
        expect(await repo.onboardingOf(id(ada))).toEqual({ marked_steps: [], dismissed_at: null, completed_at: null, acknowledged_steps: ["a", "b"] });
        expect(await repo.onboardingOf(id(bo))).toBeNull();
      });

      it("refuses tour state for a member that does not exist", async () => {
        await expect(ctx.repo().saveOnboarding(ctx.missingMemberId, { marked_steps: [] })).rejects.toThrow();
      });
    });

    describe("Slack connection", () => {
      it("finds a member's connection, revoked or not, without its secrets", async () => {
        const repo = ctx.repo();
        expect(await repo.slackConnectionOf(id(ada))).toBeNull();

        await ctx.seedSlackConnection(id(ada), "U_CONTRACT_A", { scopes: ["users:read", "channels:history"] });
        await ctx.seedSlackConnection(id(bo), "U_CONTRACT_B", { revoked: true });
        const connected = await repo.slackConnectionOf(id(ada));
        expect(connected).toEqual({ slack_user_id: "U_CONTRACT_A", connected_at: expect.any(String), revoked_at: null, scopes: ["users:read", "channels:history"] });
        expect(Object.keys(connected!).sort()).toEqual(["connected_at", "revoked_at", "scopes", "slack_user_id"]);
        expect((await repo.slackConnectionOf(id(bo)))?.revoked_at).toEqual(expect.any(String));
      });

      it("says whether another member holds a Slack user", async () => {
        const repo = ctx.repo();
        await ctx.seedSlackConnection(id(ada), "U_CONTRACT_A");

        expect(await repo.slackUserConnectedByOther("U_CONTRACT_A", id(bo))).toBe(true);
        expect(await repo.slackUserConnectedByOther("U_CONTRACT_A", id(ada))).toBe(false);
        expect(await repo.slackUserConnectedByOther("U_CONTRACT_NOBODY", id(bo))).toBe(false);
      });

      it("maps every connected Slack user to its member, revoked connections included", async () => {
        const repo = ctx.repo();
        await ctx.seedSlackConnection(id(ada), "U_CONTRACT_A");
        await ctx.seedSlackConnection(id(bo), "U_CONTRACT_B", { revoked: true });

        const links = await repo.slackUserLinks();
        expect(links.get("U_CONTRACT_A")).toBe(id(ada));
        expect(links.get("U_CONTRACT_B")).toBe(id(bo));
      });
    });
  });
}
