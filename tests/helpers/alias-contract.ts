import { describe, it, expect, beforeEach } from "vitest";
import type { AliasRepository } from "@/lib/data/aliases";

export type AliasContractContext = {
  repo: () => AliasRepository;
  memberIds: readonly [string, string];
  /** Each member's primary email: what an email alias's canonical form is. */
  memberEmails: readonly [string, string];
  /** A string no other run has used (aliases are unique across the whole table). */
  unique: (label: string) => string;
  /** Replace the context's members' aliases with these. */
  seed: (data: { names?: { member: 0 | 1; alias: string; source: "zoom" | "slack"; active?: boolean }[]; emails?: { member: 0 | 1; email: string; active?: boolean }[] }) => Promise<void>;
};

/** Behavior every `AliasRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineAliasContract(name: string, setup: () => AliasContractContext) {
  describe(`${name} (AliasRepository contract)`, () => {
    let ctx: AliasContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists name aliases as the matchers read them, all or only the active ones", async () => {
      const [a, b] = ctx.memberIds;
      const zoom = ctx.unique("Ada Z");
      const slack = ctx.unique("ada-s");
      const off = ctx.unique("Ada Old");
      await ctx.seed({
        names: [
          { member: 0, alias: zoom, source: "zoom" },
          { member: 1, alias: slack, source: "slack" },
          { member: 0, alias: off, source: "zoom", active: false },
        ],
      });
      const ours = (rows: { member_id: string; alias: string; source: string }[]) => rows.filter((r) => [a, b].includes(r.member_id)).map((r) => `${r.member_id}|${r.alias}|${r.source}`).sort();

      expect(ours(await ctx.repo().nameAliases())).toEqual([`${a}|${zoom}|zoom`, `${a}|${off}|zoom`, `${b}|${slack}|slack`].sort());
      expect(ours(await ctx.repo().nameAliases({ activeOnly: true }))).toEqual([`${a}|${zoom}|zoom`, `${b}|${slack}|slack`].sort());
    });

    it("lists email aliases with their canonical form, all or only the active ones", async () => {
      const email = (label: string) => `${ctx.unique(label).replace(/\s+/g, "-").toLowerCase()}@example.test`;
      const on = email("ada");
      const off = email("ada-old");
      await ctx.seed({ emails: [{ member: 0, email: on }, { member: 1, email: off, active: false }] });
      const ours = (rows: { alias_email: string; canonical_email: string }[]) => rows.map((r) => r.alias_email).filter((e) => [on, off].includes(e)).sort();

      expect(ours(await ctx.repo().emailAliases())).toEqual([off, on].sort());
      expect(ours(await ctx.repo().emailAliases({ activeOnly: true }))).toEqual([on]);
      const row = (await ctx.repo().emailAliases()).find((r) => r.alias_email === on)!;
      expect(row.canonical_email).toBe(ctx.memberEmails[0]); // an alias is canonicalized to its member's primary email
    });

    it("counts name aliases", async () => {
      await ctx.seed({});
      const before = await ctx.repo().nameAliasCount();

      await ctx.seed({ names: [{ member: 0, alias: ctx.unique("One"), source: "zoom" }, { member: 1, alias: ctx.unique("Two"), source: "slack" }] });

      expect(await ctx.repo().nameAliasCount()).toBe(before + 2);
    });

    it("reads past a thousand aliases", async () => {
      await ctx.seed({ names: Array.from({ length: 1050 }, (_, i) => ({ member: (i % 2) as 0 | 1, alias: ctx.unique(`Bulk ${i}`), source: "zoom" as const })) });
      const [a, b] = ctx.memberIds;

      const mine = (await ctx.repo().nameAliases()).filter((r) => [a, b].includes(r.member_id));

      expect(mine).toHaveLength(1050);
    });

    it("lists a member's own names newest first, finds one by its text, and adds only unused text", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.seed({});
      const first = ctx.unique("Pen One");
      const second = ctx.unique("Pen Two");

      expect(await ctx.repo().addName(a, first, "member")).toBe(true);
      expect(await ctx.repo().addName(a, second, "member")).toBe(true);
      expect(await ctx.repo().addName(b, first, "member")).toBe(false); // taken by another member
      expect(await ctx.repo().addName(a, first, "member")).toBe(false); // and by the same one

      expect((await ctx.repo().namesOf(a)).map((n) => [n.alias, n.source, n.active])).toEqual([[second, "member", true], [first, "member", true]]);
      expect(await ctx.repo().namesOf(b)).toEqual([]);
      expect(await ctx.repo().findName(a, first)).toEqual({ id: expect.any(String), active: true });
      expect(await ctx.repo().findName(b, first)).toBeNull();
    });

    it("turns a member's own name on and off, and refuses another member's", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.seed({});
      const alias = ctx.unique("Toggle");
      await ctx.repo().addName(a, alias, "member");
      const { id } = (await ctx.repo().findName(a, alias))!;

      expect(await ctx.repo().setNameActive(a, id, false)).toBe(true);
      expect((await ctx.repo().findName(a, alias))!.active).toBe(false);
      expect(await ctx.repo().setNameActive(b, id, true)).toBe(false);
      expect((await ctx.repo().findName(a, alias))!.active).toBe(false);
      expect(await ctx.repo().setNameActive(a, id, true)).toBe(true);
      expect((await ctx.repo().findName(a, alias))!.active).toBe(true);
    });
  });
}
