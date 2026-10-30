import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import { apiFetch } from "../../helpers/api-fetch";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { solidImage } from "../../helpers/media-fixtures";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createClient: async () => getTestSupabaseAdminClient() };
});
vi.mock("@/lib/supabase/service", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() };
});

import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

/** A member's book cover goes into the media library as their own image, at any size. */
const db = getTestSupabaseAdminClient();
const RUN = Date.now();
let memberId: string;
let userId: string;
const assetIds: string[] = [];
let n = 0;
const picture = (w: number, h: number) => solidImage(w, h, "png", { r: (RUN + ++n) % 256, g: n * 11, b: (RUN >> 4) % 256 });

async function post(bytes?: Buffer | Uint8Array, name = "cover.png") {
  const form = new FormData();
  if (bytes) form.set("file", new File([new Uint8Array(bytes)], name));
  const res = await apiFetch("/api/bookshelf/cover", { method: "POST", body: form });
  const body = await res.clone().json().catch(() => null);
  if (body?.assetId) assetIds.push(body.assetId);
  return { res, body };
}

beforeAll(async () => {
  const { data, error } = await db.from("members").insert({ name: `Cover Author ${RUN}`, email: `cover-${RUN}@example.com`, joined_at: "2026-01-01", status: "active" }).select("id").single();
  if (error) throw new Error(error.message);
  memberId = data.id;
  const user = await db.auth.admin.createUser({ email: `cover-${RUN}@example.com`, email_confirm: true });
  if (user.error) throw new Error(user.error.message);
  userId = user.data.user.id;
});

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: userId, email: `cover-${RUN}@example.com` });
  vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId, memberName: "Cover Author", memberEmail: `cover-${RUN}@example.com`, isSudo: false });
});

afterAll(async () => {
  const { data } = await db.from("media_assets").select("id, storage_path").in("id", assetIds);
  const paths = (data ?? []).map((a) => a.storage_path);
  for (const id of assetIds) {
    const { data: files } = await db.storage.from("media").list(`renditions/${id}`);
    paths.push(...(files ?? []).map((f) => `renditions/${id}/${f.name}`));
  }
  if (paths.length) await db.storage.from("media").remove(paths);
  await db.from("media_assets").delete().in("id", assetIds);
  await db.from("members").delete().eq("id", memberId);
  await db.auth.admin.deleteUser(userId);
});

describe("POST /api/bookshelf/cover", () => {
  it("needs a signed-in member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await post(await picture(100, 150))).res.status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u", email: "x@example.com" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect((await post(await picture(100, 150))).res.status).toBe(403);
  });

  it("takes a cover of any size as the member's own library image and answers where it's shown", async () => {
    const { res, body } = await post(await picture(1200, 1800), "My Cover.png");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ width: 1200, height: 1800, convertedFrom: null, duplicate: false });
    expect(body.url).toBe(`/api/media/${body.assetId}/book_cover_shelf`);

    const { data: asset } = await db.from("media_assets").select("*").eq("id", body.assetId).single();
    expect(asset).toMatchObject({ owner_member_id: memberId, title: "My Cover", kind: "image", is_public: false, width: 1200, height: 1800 });

    // The shelf size and the Amazon size are made from it on request.
    const shelf = await apiFetch(body.url);
    expect(shelf.status).toBe(200);
    const meta = await sharp(Buffer.from(await shelf.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([290, 430]);
    const amazon = await apiFetch(`/api/media/${body.assetId}/book_cover_kdp_ebook?download=1`);
    expect(amazon.status).toBe(200);
    expect(amazon.headers.get("content-disposition")).toContain("cover-kindle.jpg");
  });

  it("accepts a small cover too (the Amazon size then says it needs a bigger one), and the same file twice is one image", async () => {
    const bytes = await picture(290, 430);
    const first = await post(bytes);
    expect(first.res.status).toBe(200);
    const again = await post(bytes);
    expect(again.body).toMatchObject({ assetId: first.body.assetId, duplicate: true });
    const amazon = await apiFetch(`/api/media/${first.body.assetId}/book_cover_kdp_ebook`);
    expect(amazon.status).toBe(422);
  });

  it("converts an iPhone HEIC photo", async () => {
    const heic = readFileSync(path.resolve(import.meta.dirname, "../../fixtures/media/solid-red-64x48.heic"));
    const { res, body } = await post(heic, "IMG_1.heic");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ convertedFrom: "heic", width: 64, height: 48 });
  });

  it("refuses no file, a file that isn't an image, and one over what a request can carry", async () => {
    expect((await post()).res.status).toBe(400);
    const notImage = await post(Buffer.from("not a picture"), "cover.png");
    expect(notImage.res.status).toBe(400);
    expect(notImage.body.error).toMatch(/Use a JPEG/);
    const huge = await post(Buffer.alloc(4 * 1024 * 1024 + 1), "cover.png");
    expect(huge.res.status).toBe(400);
    expect(huge.body.error).toBe("Cover must be under 4 MB");
  });

  it("stores the cover for the member being acted as, not the signed-in admin, during sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId, memberName: "Cover Author", memberEmail: `cover-${RUN}@example.com`, isSudo: true });
    const { body } = await post(await picture(500, 800));
    const { data: asset } = await db.from("media_assets").select("owner_member_id").eq("id", body.assetId).single();
    expect(asset?.owner_member_id).toBe(memberId);
  });
});
