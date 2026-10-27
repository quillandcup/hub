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

    it("finds which name aliases a member owns, moves some to another member, and deletes some", async () => {
      const [a, b] = ctx.memberIds;
      const [one, two, three] = [ctx.unique("Move One"), ctx.unique("Move Two"), ctx.unique("Move Three")];
      await ctx.seed({ names: [{ member: 0, alias: one, source: "zoom" }, { member: 0, alias: two, source: "zoom" }, { member: 1, alias: three, source: "slack" }] });
      const id = async (member: string, alias: string) => (await ctx.repo().findName(member, alias))!.id;
      const [idOne, idTwo, idThree] = [await id(a, one), await id(a, two), await id(b, three)];

      expect((await ctx.repo().ownedNameIds(a, [idOne, idThree])).sort()).toEqual([idOne]);
      expect(await ctx.repo().ownedNameIds(a, [])).toEqual([]);

      await ctx.repo().moveNames([idOne], b);
      expect((await ctx.repo().namesOf(b)).map((n) => n.alias).sort()).toEqual([one, three].sort());
      expect((await ctx.repo().namesOf(a)).map((n) => n.alias)).toEqual([two]);

      await ctx.repo().removeNames([idTwo, idThree]);
      expect((await ctx.repo().namesOf(a)).length + (await ctx.repo().namesOf(b)).length).toBe(1);
    });

    it("upserts a name alias, taking it over from another member", async () => {
      const [a, b] = ctx.memberIds;
      const alias = ctx.unique("Taken Over");
      await ctx.seed({ names: [{ member: 0, alias, source: "slack" }] });

      await ctx.repo().upsertName(b, alias, "zoom");

      expect(await ctx.repo().findName(a, alias)).toBeNull();
      expect(await ctx.repo().findName(b, alias)).not.toBeNull();
      expect((await ctx.repo().namesOf(b)).filter((n) => n.alias === alias)).toHaveLength(1);
    });

    it("finds, moves and deletes email aliases, and upserts one onto another member", async () => {
      const [a, b] = ctx.memberIds;
      const email = (label: string) => `${ctx.unique(label).replace(/\s+/g, "-").toLowerCase()}@example.test`;
      const [e1, e2, e3, e4] = [email("e1"), email("e2"), email("e3"), email("e4")];
      await ctx.seed({ emails: [{ member: 0, email: e1 }, { member: 0, email: e2 }, { member: 1, email: e3 }] });
      const held = async (address: string) => (await ctx.repo().findEmail(address))!;

      expect(await ctx.repo().findEmail(email("nobody"))).toBeNull();
      expect(await held(e1)).toEqual({ id: expect.any(String), memberId: a });
      expect((await ctx.repo().ownedEmails(a, [(await held(e1)).id, (await held(e3)).id])).map((r) => r.alias_email)).toEqual([e1]);

      await ctx.repo().moveEmails([(await held(e1)).id], b);
      expect((await held(e1)).memberId).toBe(b);

      await ctx.repo().moveAllEmails(a, b);
      expect((await held(e2)).memberId).toBe(b);

      await ctx.repo().removeEmails([(await held(e3)).id]);
      expect(await ctx.repo().findEmail(e3)).toBeNull();

      await ctx.repo().upsertEmail(a, e4, "manual");
      expect((await held(e4)).memberId).toBe(a);
      await ctx.repo().upsertEmail(b, e4, "manual");
      expect((await held(e4)).memberId).toBe(b);
    });

    it("lists a member's own email aliases newest first, adds only unused addresses, and toggles their own", async () => {
      const [a, b] = ctx.memberIds;
      const email = (label: string) => `${ctx.unique(label).replace(/\s+/g, "-").toLowerCase()}@example.test`;
      const [first, second] = [email("own1"), email("own2")];
      await ctx.seed({});

      expect(await ctx.repo().addEmail(a, first, "manual")).toBe(true);
      expect(await ctx.repo().addEmail(a, second, "manual")).toBe(true);
      expect(await ctx.repo().addEmail(b, first, "manual")).toBe(false);

      const mine = await ctx.repo().emailsOf(a);
      expect(mine.map((e) => [e.alias_email, e.source, e.active])).toEqual([[second, "manual", true], [first, "manual", true]]);
      expect(await ctx.repo().emailsOf(b)).toEqual([]);

      expect(await ctx.repo().setEmailActive(b, mine[0].id, false)).toBe(false);
      expect(await ctx.repo().setEmailActive(a, mine[0].id, false)).toBe(true);
      expect((await ctx.repo().emailsOf(a))[0].active).toBe(false);
    });

    it("removes a member's alias by address, and upserts one switched on or off", async () => {
      const [a] = ctx.memberIds;
      const email = (label: string) => `${ctx.unique(label).replace(/\s+/g, "-").toLowerCase()}@example.test`;
      const [gone, kept, flipped] = [email("gone"), email("kept"), email("flip")];
      await ctx.seed({ emails: [{ member: 0, email: gone }, { member: 1, email: kept }] });

      await ctx.repo().removeEmailOf(a, gone);
      await ctx.repo().removeEmailOf(a, kept); // not theirs: untouched
      expect(await ctx.repo().findEmail(gone)).toBeNull();
      expect(await ctx.repo().findEmail(kept)).not.toBeNull();

      await ctx.repo().upsertEmail(a, flipped, "manual", false);
      expect((await ctx.repo().emailsOf(a)).find((e) => e.alias_email === flipped)!.active).toBe(false);
      await ctx.repo().upsertEmail(a, flipped, "manual", true);
      expect((await ctx.repo().emailsOf(a)).find((e) => e.alias_email === flipped)!.active).toBe(true);
      await ctx.repo().upsertEmail(a, flipped, "manual");
      expect((await ctx.repo().emailsOf(a)).find((e) => e.alias_email === flipped)!.active).toBe(true);
    });

    it("lists every alias with its member, by alias text, and finds one by id", async () => {
      const [a, b] = ctx.memberIds;
      const [late, early] = [ctx.unique("Zed"), ctx.unique("Abe")];
      await ctx.seed({ names: [{ member: 0, alias: late, source: "zoom" }, { member: 1, alias: early, source: "slack" }] });

      const all = await ctx.repo().namesWithMembers();
      const ours = all.filter((r) => [late, early].includes(r.alias));
      expect(ours.map((r) => [r.alias, r.member.id])).toEqual([[early, b], [late, a]]);
      expect(ours[0].member).toMatchObject({ id: b, name: expect.any(String), status: expect.any(String) });

      const id = (await ctx.repo().findName(a, late))!.id;
      expect(await ctx.repo().nameById(id)).toEqual({ id, memberId: a, alias: late });
      expect(await ctx.repo().nameById("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("finds the active Slack ids members are linked to, not zoom names or switched-off ones", async () => {
      const [a, b] = ctx.memberIds;
      const [slack, off, zoom] = [ctx.unique("U1"), ctx.unique("U2"), ctx.unique("Zoom Name")];
      await ctx.seed({
        names: [
          { member: 0, alias: slack, source: "slack" },
          { member: 0, alias: off, source: "slack", active: false },
          { member: 1, alias: zoom, source: "zoom" },
        ],
      });

      expect(await ctx.repo().slackLinks([a, b])).toEqual([{ member_id: a, alias: slack }]);
      expect(await ctx.repo().slackLinks([])).toEqual([]);
    });

    it("adds several names at once, all or nothing", async () => {
      const [a, b] = ctx.memberIds;
      const [one, two] = [ctx.unique("Bulk A"), ctx.unique("Bulk B")];
      await ctx.seed({});

      expect(await ctx.repo().addNames([])).toBe(0);
      expect(await ctx.repo().addNames([{ memberId: a, alias: one, source: "zoom" }, { memberId: b, alias: two, source: "zoom" }])).toBe(2);
      await expect(ctx.repo().addNames([{ memberId: a, alias: ctx.unique("Fresh"), source: "zoom" }, { memberId: b, alias: one, source: "zoom" }])).rejects.toThrow();
      expect((await ctx.repo().namesOf(a)).map((n) => n.alias)).toEqual([one]);
    });

    it("reads email aliases by owner, by member set, and by the primary email they resolve to", async () => {
      const [a, b] = ctx.memberIds;
      const email = (label: string) => `${ctx.unique(label).replace(/\s+/g, "-").toLowerCase()}@example.test`;
      const [on, off, other] = [email("on"), email("off"), email("other")];
      await ctx.seed({ emails: [{ member: 0, email: on }, { member: 0, email: off, active: false }, { member: 1, email: other }] });

      const owners = (await ctx.repo().emailOwners()).filter((r) => [on, off, other].includes(r.alias_email));
      expect(owners.map((r) => `${r.alias_email}|${r.member_id}`).sort()).toEqual([`${on}|${a}`, `${other}|${b}`].sort());

      const ofBoth = (await ctx.repo().emailsOfMembers([a, b])).map((r) => `${r.member_id}|${r.alias_email}`).sort();
      expect(ofBoth).toEqual([`${a}|${on}`, `${a}|${off}`, `${b}|${other}`].sort());
      expect((await ctx.repo().emailsOfMembers([b])).map((r) => r.alias_email)).toEqual([other]);
      expect(await ctx.repo().emailsOfMembers([])).toEqual([]);

      expect(await ctx.repo().activeEmailsFor(ctx.memberEmails[0])).toEqual([on]);
      expect(await ctx.repo().activeEmailsFor(email("nobody"))).toEqual([]);
    });
  });
}

