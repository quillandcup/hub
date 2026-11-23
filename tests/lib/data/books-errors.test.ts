import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { BookExistsError, SupabaseBookRepository } from "@/lib/data/books";

/** A client whose every query answers with the given error: the repository must throw it, not return an empty result. */
function failingDb(error: { message: string; code?: string }): Db {
  const answer = { data: null, error, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "eq", "is", "in", "or", "gte", "lte", "lt", "neq", "ilike", "order", "range"]) chain[m] = () => chain;
  chain.single = async () => answer;
  chain.maybeSingle = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain } as unknown as Db;
}

describe("SupabaseBookRepository database errors", () => {
  const repo = new SupabaseBookRepository(failingDb({ message: "database is down" }));
  const id = "book_AAAAAAAAAAA1";

  it.each([
    ["shelf", () => repo.shelf("mbr_AAAAAAAAAAA1")],
    ["ofMember", () => repo.ofMember("mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA1")],
    ["mine", () => repo.mine("mbr_AAAAAAAAAAA1")],
    ["add", () => repo.add({ member_id: "mbr_AAAAAAAAAAA1", title: "T", cover_url: "c", editions: [{ format: "print", purchase_url: "p", price: null }], published_date: "2026-01-01" })],
    ["update", () => repo.update(id, { title: "T" })],
    ["remove", () => repo.remove(id)],
    ["coverAssetIdOf", () => repo.coverAssetIdOf(id)],
    ["countLive", () => repo.countLive("mbr_AAAAAAAAAAA1")],
    ["liveDates", () => repo.liveDates("mbr_AAAAAAAAAAA1", "self")],
    ["liveDatesByMember", () => repo.liveDatesByMember()],
    ["ofMember (another viewer)", () => repo.ofMember("mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2")],
    ["liveDates (others)", () => repo.liveDates("mbr_AAAAAAAAAAA1", "others")],
    ["countPublishedOnOrBefore", () => repo.countPublishedOnOrBefore("2026-01-01")],
    ["publicShelf", () => repo.publicShelf({ genre: null, limit: 5 })],
    ["publicShelf (a genre)", () => repo.publicShelf({ genre: "fantasy", limit: 5 })],
    ["isPublicCover", () => repo.isPublicCover("media_AAAAAAAAAAA1")],
    ["publicBookCountsByMember", () => repo.publicBookCountsByMember()],
    ["search", () => repo.search({ viewerId: "mbr_AAAAAAAAAAA1", words: ["a"], authorIds: ["mbr_AAAAAAAAAAA1"], after: "2026-01-01", before: "2027-01-01", limit: 5, offset: 0 })],
    ["withoutCoverAsset", () => repo.withoutCoverAsset()],
    ["adoptCover", () => repo.adoptCover(id, "https://example.com/c.png", { url: "/api/media/x/book_cover_shelf", assetId: "media_AAAAAAAAAAA1" })],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("add reports a taken project as BookExistsError, carrying the database's message", async () => {
    const taken = new SupabaseBookRepository(failingDb({ message: "duplicate key value", code: "23505" }));
    const error = await taken.add({ member_id: "mbr_AAAAAAAAAAA1", title: "T", cover_url: "c", editions: [{ format: "print", purchase_url: "p", price: null }], published_date: "2026-01-01", project_id: "wprj_AAAAAAAAAAA1" }).catch((e) => e);
    expect(error).toBeInstanceOf(BookExistsError);
    expect(error.message).toBe("duplicate key value");
  });
});
