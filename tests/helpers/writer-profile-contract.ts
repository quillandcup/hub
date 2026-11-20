import { describe, it, expect, beforeEach } from "vitest";
import { PublicNameNotAllowedError, type WriterProfileRepository } from "@/lib/data/writer-profiles";
import type { AliasRepository } from "@/lib/data/aliases";
import { WRITER_PROFILES } from "@/lib/config";

const DAY_MS = 24 * 60 * 60 * 1000;
const RESERVE = WRITER_PROFILES.handleReservationDays;
const T0 = new Date("2027-03-01T12:00:00Z");
const after = (days: number) => new Date(T0.getTime() + days * DAY_MS);

export type WriterProfileContractContext = {
  profiles: () => WriterProfileRepository;
  aliases: () => AliasRepository;
  /** Two members who start with no page and no pen names: "Ada Example" (legal name "Ada Legalname") and "Grace Example". */
  members: readonly [string, string];
  /** A handle no other test or run uses. */
  unique: (label: string) => string;
  /** Removes both members' pages and old handles, and their pen names. */
  reset: () => Promise<void>;
  setDisplayName: (memberId: string, name: string | null) => Promise<void>;
  setPhoto: (memberId: string, url: string | null) => Promise<void>;
  /** Adds a pen name; `isPublic` is only possible for source "member". Returns its id. */
  addAlias: (memberId: string, alias: string, source: "member" | "zoom" | "slack", options?: { isPublic?: boolean; active?: boolean }) => Promise<string>;
  /** Changes a pen name's switches behind the repository's back (as staff could). */
  changeAlias: (aliasId: string, changes: { isPublic?: boolean; active?: boolean }) => Promise<void>;
};

/**
 * Behavior every `WriterProfileRepository` must have; run against the in-memory twin (unit) and Supabase (db). The handle
 * history is tested with a chosen `now`, so the reservation never depends on the real clock.
 */
export function defineWriterProfileContract(name: string, setup: () => WriterProfileContractContext) {
  describe(`${name} (WriterProfileRepository contract)`, () => {
    let ctx: WriterProfileContractContext;
    let ada: string;
    let grace: string;
    const claim = (member: string, handle: string, now = T0) => ctx.profiles().setHandle(member, handle, { reserveDays: RESERVE, now });
    const turnOn = (member: string) => ctx.profiles().update(member, { isPublic: true });

    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
      [ada, grace] = ctx.members;
      await ctx.setDisplayName(ada, "Ada Example");
      await ctx.setDisplayName(grace, null);
      await ctx.setPhoto(ada, null);
    });

    describe("claiming a handle", () => {
      it("creates a page that is off, with nothing public yet", async () => {
        const handle = ctx.unique("ada");
        const before = await ctx.profiles().publicCount();
        expect(await ctx.profiles().ofMember(ada)).toBeNull();

        expect(await claim(ada, handle)).toBe("created");

        expect(await ctx.profiles().ofMember(ada)).toEqual({ handle, isPublic: false, publicNameAliasId: null, showPhoto: false, bio: null, publishedAt: null });
        expect(await ctx.profiles().publicByHandle(handle)).toEqual({ kind: "none" });
        expect(await ctx.profiles().publicCount()).toBe(before);
      });

      it("says unchanged for their own handle again", async () => {
        const handle = ctx.unique("ada");
        await claim(ada, handle);
        expect(await claim(ada, handle)).toBe("unchanged");
      });

      it("refuses a handle another page has, whatever the case it was asked for in (handles are stored lowercase)", async () => {
        const handle = ctx.unique("ada");
        await claim(ada, handle);

        expect(await claim(grace, handle)).toBe("taken");
        expect(await ctx.profiles().handleAvailability(grace, handle, T0)).toBe("taken");
        expect(await ctx.profiles().handleAvailability(ada, handle, T0)).toBe("yours");
        expect(await ctx.profiles().ofMember(grace)).toBeNull();
      });

      it("says a free handle is available", async () => {
        expect(await ctx.profiles().handleAvailability(ada, ctx.unique("free"), T0)).toBe("available");
      });
    });

    describe("changing a handle: history, redirect and reservation", () => {
      it("moves the page, keeps the old handle for them, and redirects it to the new one", async () => {
        const first = ctx.unique("ada");
        const second = ctx.unique("ada-new");
        await claim(ada, first);
        await turnOn(ada);

        expect(await claim(ada, second)).toBe("changed");

        expect((await ctx.profiles().ofMember(ada))?.handle).toBe(second);
        expect(await ctx.profiles().publicByHandle(first)).toEqual({ kind: "redirect", handle: second });
        expect(await ctx.profiles().publicByHandle(second)).toMatchObject({ kind: "page", profile: { handle: second } });
      });

      it("keeps the old handle for the previous owner for the configured days: someone else cannot take it", async () => {
        const first = ctx.unique("ada");
        await claim(ada, first);
        await claim(ada, ctx.unique("ada-new"));

        expect(await claim(grace, first, after(1))).toBe("reserved");
        expect(await ctx.profiles().handleAvailability(grace, first, after(RESERVE - 1))).toBe("reserved");
        expect(await ctx.profiles().ofMember(grace)).toBeNull();
      });

      it("frees the old handle once the period has passed, and then the redirect goes away", async () => {
        const first = ctx.unique("ada");
        const second = ctx.unique("ada-new");
        await claim(ada, first);
        await turnOn(ada);
        await claim(ada, second);

        expect(await ctx.profiles().handleAvailability(grace, first, after(RESERVE + 1))).toBe("available");
        expect(await claim(grace, first, after(RESERVE + 1))).toBe("created");

        expect(await ctx.profiles().publicByHandle(first)).toEqual({ kind: "none" }); // grace's page is off: not ada's redirect
        await turnOn(grace);
        expect(await ctx.profiles().publicByHandle(first)).toMatchObject({ kind: "page", profile: { handle: first } });
      });

      it("lets the previous owner take their old handle back at any time, which ends its redirect", async () => {
        const first = ctx.unique("ada");
        const second = ctx.unique("ada-new");
        await claim(ada, first);
        await turnOn(ada);
        await claim(ada, second);
        expect(await ctx.profiles().handleAvailability(ada, first, after(1))).toBe("available");

        expect(await claim(ada, first, after(1))).toBe("changed");

        expect((await ctx.profiles().ofMember(ada))?.handle).toBe(first);
        expect(await ctx.profiles().publicByHandle(first)).toMatchObject({ kind: "page" });
        // The one they left is held for them now, and the earlier hold on `first` is gone.
        expect(await claim(grace, second, after(2))).toBe("reserved");
        expect(await claim(grace, first, after(2))).toBe("taken");
      });

      it("holds every handle they gave up, not just the last one", async () => {
        const [a, b, c] = [ctx.unique("one"), ctx.unique("two"), ctx.unique("three")];
        await claim(ada, a);
        await claim(ada, b);
        await claim(ada, c);

        expect(await claim(grace, a, after(1))).toBe("reserved");
        expect(await claim(grace, b, after(1))).toBe("reserved");
      });

      it("does not redirect from an old handle while the page is off, so nothing shows that it exists", async () => {
        const first = ctx.unique("ada");
        await claim(ada, first);
        await claim(ada, ctx.unique("ada-new"));

        expect(await ctx.profiles().publicByHandle(first)).toEqual({ kind: "none" });
      });
    });

    describe("changing the settings", () => {
      it("turns the page on, remembers when it first went public, and turns it off", async () => {
        const handle = ctx.unique("ada");
        const before = await ctx.profiles().publicCount();
        await claim(ada, handle);

        const on = await ctx.profiles().update(ada, { isPublic: true, bio: "I write cozy mysteries." });
        expect(on).toMatchObject({ isPublic: true, bio: "I write cozy mysteries.", publishedAt: expect.any(String) });
        expect(await ctx.profiles().publicCount()).toBe(before + 1);

        const off = await ctx.profiles().update(ada, { isPublic: false });
        expect(off).toMatchObject({ isPublic: false, publishedAt: on?.publishedAt });
        expect(await ctx.profiles().publicByHandle(handle)).toEqual({ kind: "none" });
        expect(await ctx.profiles().publicCount()).toBe(before);
      });

      it("returns null when they have no page, and leaves everything alone with no changes", async () => {
        expect(await ctx.profiles().update(ada, { isPublic: true })).toBeNull();
        await claim(ada, ctx.unique("ada"));
        expect(await ctx.profiles().update(ada, {})).toMatchObject({ isPublic: false });
      });

      it("only changes the member's own page", async () => {
        await claim(ada, ctx.unique("ada"));
        await claim(grace, ctx.unique("grace"));

        await ctx.profiles().update(ada, { isPublic: true });

        expect((await ctx.profiles().ofMember(grace))?.isPublic).toBe(false);
      });
    });

    describe("what a visitor gets", () => {
      it("is the display name by default, never the legal name", async () => {
        const handle = ctx.unique("ada");
        await claim(ada, handle);
        await turnOn(ada);

        const found = await ctx.profiles().publicByHandle(handle);

        expect(found).toMatchObject({ kind: "page", profile: { handle, name: "Ada Example", photoUrl: null, bio: null } });
        expect(JSON.stringify(found)).not.toContain("Legalname");
      });

      it("is the account name when the member has no display name", async () => {
        const handle = ctx.unique("grace");
        await claim(grace, handle);
        await turnOn(grace);

        expect(await ctx.profiles().publicByHandle(handle)).toMatchObject({ kind: "page", profile: { name: "Grace Example" } });
      });

      it("returns only the fields meant to be public", async () => {
        const handle = ctx.unique("ada");
        await ctx.setPhoto(ada, "https://photos.example.com/ada.png");
        await claim(ada, handle);
        await ctx.profiles().update(ada, { isPublic: true, showPhoto: true, bio: "Hello." });

        const found = await ctx.profiles().publicByHandle(handle);

        if (found.kind !== "page") throw new Error("expected a page");
        expect(Object.keys(found.profile).sort()).toEqual(["bio", "handle", "name", "photoUrl", "publishedAt", "updatedAt"]);
        expect(found.profile).toMatchObject({ handle, name: "Ada Example", photoUrl: "https://photos.example.com/ada.png", bio: "Hello." });
      });

      it("shows no photo unless the member chose to show it", async () => {
        const handle = ctx.unique("ada");
        await ctx.setPhoto(ada, "https://photos.example.com/ada.png");
        await claim(ada, handle);
        await turnOn(ada);

        expect(await ctx.profiles().publicByHandle(handle)).toMatchObject({ profile: { photoUrl: null } });
        await ctx.profiles().update(ada, { showPhoto: true });
        expect(await ctx.profiles().publicByHandle(handle)).toMatchObject({ profile: { photoUrl: "https://photos.example.com/ada.png" } });
        await ctx.profiles().update(ada, { showPhoto: false });
        expect(await ctx.profiles().publicByHandle(handle)).toMatchObject({ profile: { photoUrl: null } });
      });

      it("never publishes a photo that is not https or comes from a host kept private, even when switched on", async () => {
        const handle = ctx.unique("ada");
        await claim(ada, handle);
        await ctx.profiles().update(ada, { isPublic: true, showPhoto: true });

        for (const url of ["http://photos.example.com/ada.png", "https://secure.gravatar.com/avatar/0123456789abcdef", "javascript:alert(1)"]) {
          await ctx.setPhoto(ada, url);
          expect(await ctx.profiles().publicByHandle(handle), url).toMatchObject({ profile: { photoUrl: null } });
        }
      });

      it("treats a page that is off and a handle nobody has the same way", async () => {
        const handle = ctx.unique("ada");
        await claim(ada, handle);

        expect(await ctx.profiles().publicByHandle(handle)).toEqual(await ctx.profiles().publicByHandle(ctx.unique("nobody")));
      });

      it("previews their own page whether or not it is on", async () => {
        const handle = ctx.unique("ada");
        expect(await ctx.profiles().previewOfMember(ada)).toBeNull();
        await claim(ada, handle);
        await ctx.profiles().update(ada, { bio: "Not public yet." });

        expect(await ctx.profiles().previewOfMember(ada)).toMatchObject({ handle, name: "Ada Example", bio: "Not public yet." });
        expect(await ctx.profiles().publicByHandle(handle)).toEqual({ kind: "none" });
      });
    });

    describe("pen names", () => {
      it("shows a pen name the member added, marked for the page and chose", async () => {
        const handle = ctx.unique("ada");
        const pen = await ctx.addAlias(ada, ctx.unique("A. E. Pen"), "member", { isPublic: true });
        await claim(ada, handle);

        await ctx.profiles().update(ada, { isPublic: true, publicNameAliasId: pen });

        const found = await ctx.profiles().publicByHandle(handle);
        expect(found).toMatchObject({ kind: "page", profile: { name: expect.stringContaining("A. E. Pen") } });
        expect((await ctx.profiles().ofMember(ada))?.publicNameAliasId).toBe(pen);
      });

      it("refuses a name that is not one of their public pen names: matching-only names, other people's, names not marked", async () => {
        await claim(ada, ctx.unique("ada"));
        const zoom = await ctx.addAlias(ada, ctx.unique("ada zoom"), "zoom");
        const slack = await ctx.addAlias(ada, ctx.unique("ada slack"), "slack");
        const unmarked = await ctx.addAlias(ada, ctx.unique("Ada Unmarked"), "member");
        const graces = await ctx.addAlias(grace, ctx.unique("Grace Pen"), "member", { isPublic: true });

        for (const id of [zoom, slack, unmarked, graces]) {
          await expect(ctx.profiles().update(ada, { publicNameAliasId: id })).rejects.toBeInstanceOf(PublicNameNotAllowedError);
        }
        expect((await ctx.profiles().ofMember(ada))?.publicNameAliasId).toBeNull();
      });

      it("never shows a matching-only alias: with no pen name chosen, the page shows the display name whatever aliases exist", async () => {
        const handle = ctx.unique("ada");
        const zoom = ctx.unique("ada zoom typo");
        const slack = ctx.unique("ada slack name");
        const legal = ctx.unique("Ada Legalname Matching");
        await ctx.addAlias(ada, zoom, "zoom");
        await ctx.addAlias(ada, slack, "slack");
        await ctx.addAlias(ada, legal, "member");
        await claim(ada, handle);
        await ctx.profiles().update(ada, { isPublic: true, bio: "Hello." });

        const found = await ctx.profiles().publicByHandle(handle);

        expect(JSON.stringify(found)).not.toContain(zoom);
        expect(JSON.stringify(found)).not.toContain(slack);
        expect(JSON.stringify(found)).not.toContain(legal);
        expect(found).toMatchObject({ kind: "page", profile: { name: "Ada Example" } });
      });

      it("falls back to the display name the moment the pen name is switched off or turned off", async () => {
        const handle = ctx.unique("ada");
        const pen = await ctx.addAlias(ada, ctx.unique("A. E. Pen"), "member", { isPublic: true });
        await claim(ada, handle);
        await ctx.profiles().update(ada, { isPublic: true, publicNameAliasId: pen });

        await ctx.changeAlias(pen, { isPublic: false });
        expect(await ctx.profiles().publicByHandle(handle)).toMatchObject({ profile: { name: "Ada Example" } });

        await ctx.changeAlias(pen, { isPublic: true });
        expect(await ctx.profiles().publicByHandle(handle)).toMatchObject({ profile: { name: expect.stringContaining("A. E. Pen") } });

        await ctx.changeAlias(pen, { active: false });
        expect(await ctx.profiles().publicByHandle(handle)).toMatchObject({ profile: { name: "Ada Example" } });
      });

      it("lets only a name the member added be marked for the page", async () => {
        const own = await ctx.addAlias(ada, ctx.unique("Own Pen"), "member");
        const zoom = await ctx.addAlias(ada, ctx.unique("ada zoom"), "zoom");
        const graces = await ctx.addAlias(grace, ctx.unique("Grace Pen"), "member");

        expect(await ctx.aliases().setNamePublic(ada, zoom, true)).toBe(false);
        expect(await ctx.aliases().setNamePublic(ada, graces, true)).toBe(false);
        expect(await ctx.aliases().setNamePublic(ada, own, true)).toBe(true);
        expect((await ctx.aliases().namesOf(ada)).find((a) => a.id === own)?.isPublic).toBe(true);
        expect((await ctx.aliases().namesOf(ada)).find((a) => a.id === zoom)?.isPublic).toBe(false);
        expect((await ctx.aliases().namesOf(grace)).find((a) => a.id === graces)?.isPublic).toBe(false);

        expect(await ctx.aliases().setNamePublic(ada, own, false)).toBe(true);
        expect((await ctx.aliases().namesOf(ada)).find((a) => a.id === own)?.isPublic).toBe(false);
      });
    });

    describe("the sitemap's list", () => {
      it("lists only public pages, in a stable order, a page at a time", async () => {
        const [a, b] = [ctx.unique("ada"), ctx.unique("grace")];
        await claim(ada, a);
        await claim(grace, b);
        expect(await ctx.profiles().publicHandles(0, 100)).toEqual([]);

        await turnOn(ada);
        await turnOn(grace);

        const all = await ctx.profiles().publicHandles(0, 1000);
        const ours = all.filter((h) => [a, b].includes(h.handle));
        expect(ours.map((h) => h.handle).sort()).toEqual([a, b].sort());
        expect(ours.every((h) => !Number.isNaN(Date.parse(h.updatedAt)))).toBe(true);
        expect(await ctx.profiles().publicCount()).toBeGreaterThanOrEqual(2);
        // Two pages of one entry each cover the same entries as one page.
        const total = await ctx.profiles().publicCount();
        const paged = [];
        for (let page = 0; page < total; page++) paged.push(...(await ctx.profiles().publicHandles(page, 1)));
        expect(paged.map((h) => h.handle).sort()).toEqual(all.map((h) => h.handle).sort());
      });

      it("leaves out a page switched off again", async () => {
        const handle = ctx.unique("ada");
        await claim(ada, handle);
        await turnOn(ada);
        await ctx.profiles().update(ada, { isPublic: false });

        expect((await ctx.profiles().publicHandles(0, 1000)).map((h) => h.handle)).not.toContain(handle);
      });
    });
  });
}
