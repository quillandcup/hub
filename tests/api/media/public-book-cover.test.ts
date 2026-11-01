import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { apiFetch } from "../../helpers/api-fetch";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { solidImage } from "../../helpers/media-fixtures";

const config = vi.hoisted(() => ({ public: false }));
vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  get BOOKSHELF_PUBLIC() {
    return config.public;
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createClient: async () => getTestSupabaseAdminClient() };
});
vi.mock("@/lib/supabase/service", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() };
});

import { getCurrentUser } from "@/lib/auth";

/** A book's cover is served to visitors who aren't signed in only while the Bookshelf is public. */
const db = getTestSupabaseAdminClient();
const RUN = Date.now();
let memberId: string;
const assets: Record<string, { id: string; storage_path: string }> = {};
const bookIds: string[] = [];
const projectIds: string[] = [];

async function addAsset(key: string, n: number) {
  const bytes = await solidImage(300, 450, "png", { r: (RUN + n) % 256, g: n * 17, b: (RUN >> 6) % 256 });
  const { data, error } = await db
    .from("media_assets")
    .insert({ storage_path: `originals/${memberId}/pub-${RUN}-${key}.png`, mime_type: "image/png", width: 300, height: 450, bytes: bytes.length, sha256: `pub-${RUN}-${key}`, title: key, owner_member_id: memberId })
    .select("id, storage_path")
    .single();
  if (error) throw new Error(error.message);
  await db.storage.from("media").upload(data.storage_path, bytes, { contentType: "image/png", upsert: true });
  assets[key] = data;
}

beforeAll(async () => {
  const member = await db.from("members").insert({ name: `Public Cover Author ${RUN}`, email: `pubcover-${RUN}@example.com`, joined_at: "2026-01-01", status: "active" }).select("id").single();
  if (member.error) throw new Error(member.error.message);
  memberId = member.data.id;
  await addAsset("book", 1);
  await addAsset("project", 2);
  await addAsset("unused", 3);
  const book = await db.from("member_books").insert({ member_id: memberId, title: `Book ${RUN}`, cover_url: "x", cover_asset_id: assets.book.id, purchase_url: "https://example.com/b", published_date: "2026-01-01" }).select("id").single();
  if (book.error) throw new Error(book.error.message);
  bookIds.push(book.data.id);
  const project = await db.from("writing_projects").insert({ member_id: memberId, title: `Project ${RUN}`, phase: "drafting", cover_asset_id: assets.project.id }).select("id").single();
  if (project.error) throw new Error(project.error.message);
  projectIds.push(project.data.id);
});

beforeEach(() => {
  config.public = false;
  vi.mocked(getCurrentUser).mockResolvedValue(null);
});

afterAll(async () => {
  await db.from("member_books").delete().in("id", bookIds);
  await db.from("writing_projects").delete().in("id", projectIds);
  const paths = Object.values(assets).map((a) => a.storage_path);
  for (const a of Object.values(assets)) {
    const { data } = await db.storage.from("media").list(`renditions/${a.id}`);
    paths.push(...(data ?? []).map((f) => `renditions/${a.id}/${f.name}`));
  }
  await db.storage.from("media").remove(paths);
  await db.from("media_assets").delete().in("id", Object.values(assets).map((a) => a.id));
  await db.from("members").delete().eq("id", memberId);
});

const shelf = (key: string) => apiFetch(`/api/media/${assets[key].id}/book_cover_shelf`);

describe("a book's cover for a visitor who isn't signed in", () => {
  it("is not served while the Bookshelf isn't public", async () => {
    expect((await shelf("book")).status).toBe(404);
  });

  it("is served at the shelf size, publicly cacheable, once the Bookshelf is public", async () => {
    config.public = true;
    const res = await shelf("book");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([290, 430]);
  });

  it("is still refused at other sizes, and for a project's cover or an image nothing uses", async () => {
    config.public = true;
    expect((await apiFetch(`/api/media/${assets.book.id}/book_cover_kdp_ebook`)).status).toBe(404);
    expect((await apiFetch(`/api/media/${assets.book.id}/thumb`)).status).toBe(404);
    expect((await apiFetch(`/api/media/${assets.book.id}/custom?width=100&height=100`)).status).toBe(404);
    expect((await shelf("project")).status).toBe(404);
    expect((await shelf("unused")).status).toBe(404);
  });

  it("is refused once the book no longer uses the image, or the image is deleted", async () => {
    config.public = true;
    await db.from("media_assets").update({ deleted_at: new Date().toISOString() }).eq("id", assets.book.id);
    expect((await shelf("book")).status).toBe(404);
    await db.from("media_assets").update({ deleted_at: null }).eq("id", assets.book.id);
    expect((await shelf("book")).status).toBe(200);
    await db.from("member_books").update({ cover_asset_id: null }).in("id", bookIds);
    expect((await shelf("book")).status).toBe(404);
    await db.from("member_books").update({ cover_asset_id: assets.book.id }).in("id", bookIds);
  });

  it("makes no difference to a signed-in member, who reads a book's cover either way", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u", email: "m@example.com" });
    expect((await shelf("book")).status).toBe(200);
    config.public = true;
    expect((await shelf("book")).status).toBe(200);
  });
});
