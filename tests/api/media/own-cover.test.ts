import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/** A member lists their own images and frames their own cover (focal point, fit); never someone else's, never anything else about it. */
const db = getTestSupabaseAdminClient();
const RUN = Date.now();
const members: string[] = [];
const assetIds: string[] = [];
let userId: string;
let mine: string;
let theirs: string;
let deleted: string;
let n = 0;

async function newMember(label: string) {
  const { data, error } = await db.from("members").insert({ name: `Cover ${label} ${RUN}`, email: `own-${label}-${RUN}@example.com`, joined_at: "2026-01-01", status: "active" }).select("id").single();
  if (error) throw new Error(error.message);
  members.push(data.id);
  return data.id as string;
}
async function newAsset(owner: string, title: string, over: Record<string, unknown> = {}) {
  const bytes = await solidImage(100, 150, "png", { r: (RUN + ++n) % 256, g: n * 13, b: 40 });
  const path = `originals/${owner}/own-cover-${RUN}-${n}.png`;
  await db.storage.from("media").upload(path, bytes, { contentType: "image/png", upsert: true });
  const { data, error } = await db.from("media_assets").insert({ storage_path: path, mime_type: "image/png", width: 100, height: 150, bytes: bytes.length, sha256: `own-cover-${RUN}-${n}`, title, owner_member_id: owner, ...over }).select("id").single();
  if (error) throw new Error(error.message);
  assetIds.push(data.id);
  return data.id as string;
}
const patch = (id: string, body: unknown) => apiFetch(`/api/bookshelf/cover/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const memberId = await newMember("a");
  const other = await newMember("b");
  const user = await db.auth.admin.createUser({ email: `own-a-${RUN}@example.com`, email_confirm: true });
  if (user.error) throw new Error(user.error.message);
  userId = user.data.user.id;
  vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId, memberName: "A", memberEmail: `own-a-${RUN}@example.com`, isSudo: false });
  mine = await newAsset(memberId, `Mine ${RUN}`);
  await newAsset(memberId, `Another ${RUN}`);
  theirs = await newAsset(other, `Theirs ${RUN}`);
  deleted = await newAsset(memberId, `Gone ${RUN}`, { deleted_at: new Date().toISOString() });
});

beforeEach(async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: userId, email: `own-a-${RUN}@example.com` });
  vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: members[0], memberName: "A", memberEmail: `own-a-${RUN}@example.com`, isSudo: false });
});

afterAll(async () => {
  const { data } = await db.from("media_assets").select("storage_path").in("id", assetIds);
  if (data?.length) await db.storage.from("media").remove(data.map((a) => a.storage_path));
  await db.from("media_assets").delete().in("id", assetIds);
  await db.from("members").delete().in("id", members);
  await db.auth.admin.deleteUser(userId);
});

describe("GET /api/bookshelf/cover", () => {
  it("needs a signed-in member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await apiFetch("/api/bookshelf/cover")).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u", email: "x@example.com" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect((await apiFetch("/api/bookshelf/cover")).status).toBe(403);
  });

  it("lists only the member's own live images, searchable by title, with their size", async () => {
    const all = await (await apiFetch(`/api/bookshelf/cover?q=${RUN}`)).json();
    expect(all.assets.map((a: { title: string }) => a.title).sort()).toEqual([`Another ${RUN}`, `Mine ${RUN}`]);
    expect(all.assets[0]).toMatchObject({ width: 100, height: 150 });
    const one = await (await apiFetch(`/api/bookshelf/cover?q=Mine&limit=1&offset=0`)).json();
    expect(one.assets.every((a: { title: string }) => a.title.startsWith("Mine"))).toBe(true);
  });
});

describe("/api/bookshelf/cover/[assetId]", () => {
  it("lets a member read their own image, and answers 404 for someone else's, a deleted one, or anything that isn't an image id", async () => {
    const own = await apiFetch(`/api/bookshelf/cover/${mine}`);
    expect(own.status).toBe(200);
    expect((await own.json()).asset).toMatchObject({ id: mine, title: `Mine ${RUN}` });
    expect((await apiFetch(`/api/bookshelf/cover/${theirs}`)).status).toBe(404);
    expect((await apiFetch(`/api/bookshelf/cover/${deleted}`)).status).toBe(404);
    expect((await apiFetch("/api/bookshelf/cover/not-an-id")).status).toBe(404);
  });

  it("needs a signed-in member with a member record", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await apiFetch(`/api/bookshelf/cover/${mine}`)).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u", email: "x@example.com" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect((await patch(mine, { focal: null })).status).toBe(403);
  });

  it("saves a focal point and a cover fit, merging fits, and ignores anything else in the body", async () => {
    const focal = await patch(mine, { focal: { x: 0.25, y: 0.75 }, title: "Hijacked", is_public: true });
    expect(focal.status).toBe(200);
    expect((await focal.json()).asset).toMatchObject({ focal_x: 0.25, focal_y: 0.75, title: `Mine ${RUN}`, is_public: false });

    expect((await patch(mine, { fits: { book_cover_shelf: "white" } })).status).toBe(200);
    const second = await patch(mine, { fits: { book_cover_kdp_ebook: "crop" } });
    expect((await second.json()).asset.fits).toEqual({ book_cover_shelf: "white", book_cover_kdp_ebook: "crop" });

    const cleared = await patch(mine, { focal: null });
    expect((await cleared.json()).asset).toMatchObject({ focal_x: null, focal_y: null });
  });

  it("refuses a bad body, a bad focal point or fit, and someone else's image", async () => {
    const malformed = await apiFetch(`/api/bookshelf/cover/${mine}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(malformed.status).toBe(400);
    expect((await patch(mine, { focal: { x: 2, y: 0 } })).status).toBe(400);
    expect((await patch(mine, { fits: { nonsense: "crop" } })).status).toBe(400);
    expect((await patch(theirs, { focal: null })).status).toBe(404);
  });
});
