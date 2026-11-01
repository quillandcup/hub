import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { solidImage } from "../../helpers/media-fixtures";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { adoptLegacyCovers } from "@/lib/media/adopt-covers";

/** Moving older covers into the library, against the real tables and bucket. */
const db = getTestSupabaseAdminClient() as unknown as Db;
const raw = getTestSupabaseAdminClient();
const RUN = Date.now();
const BOOK_LINK = `https://pics.example.test/book-${RUN}.png`;
const PROJECT_LINK = `https://pics.example.test/project-${RUN}.png`;
let memberId: string;
let bookId: string;
let projectId: string;
const bytes: Record<string, Buffer> = {};

const deps = () => {
  const repos = createRepos(db);
  return {
    media: repos.media,
    writing: repos.writing,
    books: repos.books,
    storage: raw.storage,
    supabaseUrl: "http://127.0.0.1:54321",
    // Only this test's covers resolve; any other older cover in the shared local database fails to read and is left alone.
    fetchCover: async (_s: unknown, _u: string, url: string) => (bytes[url] ? { bytes: bytes[url] } : { error: "HTTP 404" }),
  };
};

beforeAll(async () => {
  bytes[BOOK_LINK] = await solidImage(1600, 2560, "png", { r: RUN % 256, g: 80, b: 120 });
  bytes[PROJECT_LINK] = await solidImage(300, 450, "png", { r: 90, g: RUN % 256, b: 10 });
  const member = await raw.from("members").insert({ name: `Legacy Cover Author ${RUN}`, email: `legacy-${RUN}@example.com`, joined_at: "2026-01-01", status: "active" }).select("id").single();
  if (member.error) throw new Error(member.error.message);
  memberId = member.data.id;
  const book = await raw.from("member_books").insert({ member_id: memberId, title: `Legacy Book ${RUN}`, cover_url: BOOK_LINK, purchase_url: "https://example.com/buy", published_date: "2026-01-01" }).select("id").single();
  if (book.error) throw new Error(book.error.message);
  bookId = book.data.id;
  const project = await raw.from("writing_projects").insert({ member_id: memberId, title: `Legacy Project ${RUN}`, phase: "drafting", cover_url: PROJECT_LINK }).select("id").single();
  if (project.error) throw new Error(project.error.message);
  projectId = project.data.id;
});

afterAll(async () => {
  const { data } = await raw.from("media_assets").select("id, storage_path").eq("owner_member_id", memberId);
  await raw.from("member_books").delete().eq("id", bookId);
  await raw.from("writing_projects").delete().eq("id", projectId);
  if (data?.length) await raw.storage.from("media").remove(data.map((a) => a.storage_path));
  await raw.from("media_assets").delete().eq("owner_member_id", memberId);
  await raw.from("members").delete().eq("id", memberId);
});

const mine = <T extends { id: string }>(rows: T[]) => rows.filter((r) => r.id === bookId || r.id === projectId);

describe("adoptLegacyCovers against the database", () => {
  it("finds the books and projects whose cover is still a link", async () => {
    const deps_ = deps();
    expect(mine(await deps_.books.withoutCoverAsset())).toEqual([{ id: bookId, member_id: memberId, title: `Legacy Book ${RUN}`, cover_url: BOOK_LINK }]);
    expect(mine(await deps_.writing.projectsWithLegacyCovers())).toEqual([{ id: projectId, member_id: memberId, title: `Legacy Project ${RUN}`, cover_url: PROJECT_LINK }]);
  });

  it("changes nothing in a dry run", async () => {
    const report = await adoptLegacyCovers(deps(), { apply: false });
    expect(report.dryRun).toBe(true);
    expect(report.amazonReady).toBeGreaterThanOrEqual(1);
    expect(report.tooSmallForAmazon).toBeGreaterThanOrEqual(1);
    expect((await raw.from("member_books").select("cover_url, cover_asset_id").eq("id", bookId).single()).data).toEqual({ cover_url: BOOK_LINK, cover_asset_id: null });
    expect((await raw.from("media_assets").select("id").eq("owner_member_id", memberId)).data).toEqual([]);
  });

  it("moves them in when applied: the member's own images, the original kept, the rows pointing at them", async () => {
    const report = await adoptLegacyCovers(deps(), { apply: true });
    expect(report.dryRun).toBe(false);
    expect(report.adopted).toBeGreaterThanOrEqual(2);

    const book = (await raw.from("member_books").select("cover_url, cover_asset_id").eq("id", bookId).single()).data!;
    const project = (await raw.from("writing_projects").select("cover_url, cover_asset_id").eq("id", projectId).single()).data!;
    expect(book.cover_url).toBe(`/api/media/${book.cover_asset_id}/book_cover_shelf`);
    expect(project.cover_url).toBe(`/api/media/${project.cover_asset_id}/book_cover_shelf`);

    const assets = (await raw.from("media_assets").select("id, owner_member_id, width, height, storage_path, title").eq("owner_member_id", memberId)).data!;
    expect(assets.map((a) => [a.id, a.width, a.height]).sort()).toEqual(
      [[book.cover_asset_id, 1600, 2560], [project.cover_asset_id, 300, 450]].sort()
    );
    for (const a of assets) expect((await raw.storage.from("media").download(a.storage_path)).error).toBeNull();
    expect(assets.find((a) => a.id === book.cover_asset_id)?.title).toBe(`Legacy Book ${RUN}`);
  });

  it("is safe to run again: nothing left to move for them, and no duplicate images", async () => {
    const deps_ = deps();
    expect(mine(await deps_.books.withoutCoverAsset())).toEqual([]);
    expect(mine(await deps_.writing.projectsWithLegacyCovers())).toEqual([]);
    await adoptLegacyCovers(deps_, { apply: true });
    expect((await raw.from("media_assets").select("id").eq("owner_member_id", memberId)).data).toHaveLength(2);
  });

  it("leaves a book alone whose cover changed after it was read", async () => {
    const books = createRepos(db).books;
    const asset = (await raw.from("media_assets").select("id").eq("owner_member_id", memberId).limit(1).single()).data!;
    const before = (await raw.from("member_books").select("cover_url, cover_asset_id").eq("id", bookId).single()).data!;
    expect(await books.adoptCover(bookId, "https://pics.example.test/earlier.png", { url: "/api/media/x/book_cover_shelf", assetId: asset.id })).toBe(false);
    expect((await raw.from("member_books").select("cover_url, cover_asset_id").eq("id", bookId).single()).data).toEqual(before);
  });
});
