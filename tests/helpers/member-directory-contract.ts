import { describe, it, expect, beforeEach } from "vitest";
import type { MemberDirectoryRepository } from "@/lib/data/member-directory";

export type SeedPerson = { key: string; name: string; displayName?: string; bio?: string; photoUrl?: string };

export type DirectoryContractContext = {
  repo: () => MemberDirectoryRepository;
  /** Replaces the members this context created with these (a member's directory row follows it); returns each one's id by key. */
  seed: (people: SeedPerson[]) => Promise<Record<string, string>>;
  /** A string no other run has used, to keep names unique across a shared database. */
  unique: (label: string) => string;
};

/** Behavior every `MemberDirectoryRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMemberDirectoryContract(name: string, setup: () => DirectoryContractContext) {
  describe(`${name} (MemberDirectoryRepository contract)`, () => {
    let ctx: DirectoryContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const NONE = "00000000-0000-4000-8000-000000000000";

    it("reads one member's public profile, and these members' profiles; others are left out", async () => {
      const tag = ctx.unique("Reader");
      const ids = await ctx.seed([
        { key: "a", name: `${tag} Ada`, displayName: `${tag} Pen`, bio: "Writes novels", photoUrl: "https://example.test/a.jpg" },
        { key: "b", name: `${tag} Fern` },
      ]);

      expect(await ctx.repo().byId(ids.a)).toMatchObject({ id: ids.a, name: `${tag} Ada`, display_name: `${tag} Pen`, bio: "Writes novels", photo_url: "https://example.test/a.jpg" });
      expect(await ctx.repo().byId(NONE)).toBeNull();

      const both = await ctx.repo().byIds([ids.a, ids.b, ids.a, NONE]);
      expect(both.map((m) => m.id).sort()).toEqual([ids.a, ids.b].sort());
      expect(await ctx.repo().byIds([])).toEqual([]);
    });

    it("lists everyone by name", async () => {
      const tag = ctx.unique("Lister");
      const ids = await ctx.seed([
        { key: "z", name: `${tag} Zed` },
        { key: "a", name: `${tag} Abe` },
      ]);

      const ours = (await ctx.repo().all()).filter((m) => [ids.z, ids.a].includes(m.id));

      expect(ours.map((m) => m.name)).toEqual([`${tag} Abe`, `${tag} Zed`]);
    });

    it("finds members whose name or display name contains what was typed, taking wildcards as plain letters", async () => {
      const tag = ctx.unique("Finder");
      const ids = await ctx.seed([
        { key: "byName", name: `${tag} Wren` },
        { key: "byPen", name: `${tag} Other`, displayName: `${tag} wRenny` },
        { key: "neither", name: `${tag} Fern` },
        { key: "wild", name: `${tag} 50%_off` },
      ]);

      const found = await ctx.repo().matching(`${tag} wren`, 10); // case-insensitive, in the name or the display name
      expect(found.map((m) => m.id).sort()).toEqual([ids.byName, ids.byPen].sort());
      expect((await ctx.repo().matching(`${tag} wrenn`, 10)).map((m) => m.id)).toEqual([ids.byPen]);

      expect(await ctx.repo().idsMatching(`${tag} 50%_`, 10)).toEqual([ids.wild]);
      expect(await ctx.repo().idsMatching(`${tag} _`, 10)).toEqual([]); // "_" is not "any letter"
      expect((await ctx.repo().matching(tag, 2)).map((m) => m.id)).toHaveLength(2); // the limit
    });

    it("finds members matching every word in their name, display name or bio, or listed by id, one page at a time", async () => {
      const tag = ctx.unique("Words");
      const ids = await ctx.seed([
        { key: "a", name: `${tag} Ada`, bio: "loves poetry" },
        { key: "b", name: `${tag} Bea`, displayName: "poetry fan" },
        { key: "c", name: `${tag} Cy`, bio: "loves prose" },
      ]);

      const poetry = await ctx.repo().searchWords([{ text: tag, alsoIds: [] }, { text: "poetry", alsoIds: [] }], { offset: 0, limit: 10 });
      expect(poetry.map((m) => m.id)).toEqual([ids.a, ids.b]);

      const withAlias = await ctx.repo().searchWords([{ text: tag, alsoIds: [] }, { text: "poetry", alsoIds: [ids.c] }], { offset: 0, limit: 10 });
      expect(withAlias.map((m) => m.id)).toEqual([ids.a, ids.b, ids.c]);

      expect((await ctx.repo().searchWords([{ text: tag, alsoIds: [] }], { offset: 1, limit: 1 })).map((m) => m.id)).toEqual([ids.b]);
    });
  });
}
