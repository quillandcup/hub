import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { apiFetch } from "../../helpers/api-fetch";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { solidImage } from "../../helpers/media-fixtures";

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

const db = getTestSupabaseAdminClient();
const RUN = Date.now();
const admin = { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
const created: string[] = [];

/** A unique picture per call, so a re-run never finds an earlier run's bytes. */
let n = 0;
const picture = (w = 800, h = 600) => solidImage(w, h, "png", { r: (RUN + ++n) % 256, g: (RUN >> 3) % 256, b: n * 7 % 256 });

async function upload(bytes: Buffer, fields: Record<string, string> = {}, headers: Record<string, string> = admin) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "Hedgies on First.png", { type: "image/png" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await apiFetch("/api/media", { method: "POST", body: form, headers });
  const body = await res.clone().json().catch(() => null);
  if (body?.asset) created.push(body.asset.id);
  return { res, body };
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
});

afterAll(async () => {
  if (created.length === 0) return;
  const { data } = await db.from("media_assets").select("id, storage_path").in("id", created);
  const paths = (data ?? []).map((a) => a.storage_path);
  for (const id of created) {
    const { data: files } = await db.storage.from("media").list(`renditions/${id}`);
    paths.push(...(files ?? []).map((f) => `renditions/${id}/${f.name}`));
  }
  if (paths.length) await db.storage.from("media").remove(paths);
  await db.from("media_assets").delete().in("id", created);
});

describe("POST /api/media", () => {
  it("needs an admin", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await picture())], "a.png"));
    expect((await apiFetch("/api/media", { method: "POST", body: form })).status).toBe(401);
  });

  it("keeps the original untouched, titles it from the file name, and answers 200 with the same asset for the same bytes", async () => {
    const bytes = await picture();
    const first = await upload(bytes, { tags: "Hedgies, On-First" });
    expect(first.res.status).toBe(201);
    expect(first.body.asset).toMatchObject({ title: "Hedgies on First", tags: ["hedgies", "on-first"], mime_type: "image/png", width: 800, height: 600, owner_member_id: null, is_public: false });
    const stored = await db.storage.from("media").download(first.body.asset.storage_path);
    expect(Buffer.from(await stored.data!.arrayBuffer()).equals(bytes)).toBe(true);

    const again = await upload(bytes);
    expect(again.res.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, asset: { id: first.body.asset.id } });
  });

  it("refuses files that aren't usable images", async () => {
    const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(svg.res.status).toBe(400);
    expect(svg.body.error).toMatch(/Use a JPEG/);
    const empty = await apiFetch("/api/media", { method: "POST", body: new FormData(), headers: admin });
    expect(empty.status).toBe(400);
  });

  it("takes a big file through a signed upload URL and then a confirm", async () => {
    const start = await apiFetch("/api/media/uploads", { method: "POST", headers: admin });
    expect(start.status).toBe(200);
    const { uploadPath, token } = await start.json();
    const bytes = await picture(1200, 900);
    const put = await db.storage.from("media").uploadToSignedUrl(uploadPath, token, bytes, { contentType: "image/png" });
    expect(put.error).toBeNull();

    const res = await apiFetch("/api/media", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ uploadPath, title: "Big one" }) });
    const body = await res.json();
    created.push(body.asset.id);
    expect(res.status).toBe(201);
    expect(body.asset).toMatchObject({ title: "Big one", width: 1200, height: 900 });
    expect((await db.storage.from("media").download(uploadPath)).data).toBeNull(); // the pending object is gone

    const bad = await apiFetch("/api/media", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ uploadPath: "../originals/x" }) });
    expect(bad.status).toBe(400);
    const missing = await apiFetch("/api/media", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ uploadPath: "uploads/not-there" }) });
    expect(missing.status).toBe(400);
    const malformed = await apiFetch("/api/media", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
  });
});

describe("GET /api/media/[id]/[preset]", () => {
  it("serves a rendition at the preset's size, caches it, and 404s unknown ids, presets and signed-out callers", async () => {
    const { body } = await upload(await picture(800, 600));
    const id = body.asset.id;

    expect((await apiFetch(`/api/media/${id}/event_card`)).status).toBe(404); // signed out, not public
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
    const res = await apiFetch(`/api/media/${id}/event_card`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("private");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([800, 450]);
    const { data: cached } = await db.storage.from("media").list(`renditions/${id}`);
    expect(cached).toHaveLength(1);

    expect((await apiFetch(`/api/media/${id}/event_card`)).status).toBe(200); // from the cache
    expect((await db.storage.from("media").list(`renditions/${id}`)).data).toHaveLength(1);
    expect((await apiFetch(`/api/media/${id}/nope`)).status).toBe(404);
    expect((await apiFetch(`/api/media/img_AAAAAAAAAAAA/event_card`)).status).toBe(404);
    expect((await apiFetch(`/api/media/not-an-id/event_card`)).status).toBe(404);
  });

  it("serves a public asset to a signed-out visitor, and not once it is deleted", async () => {
    const { body } = await upload(await picture());
    const id = body.asset.id;
    const patch = await apiFetch(`/api/media/${id}`, { method: "PATCH", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ is_public: true }) });
    expect(patch.status).toBe(200);

    const res = await apiFetch(`/api/media/${id}/thumb`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");

    expect((await apiFetch(`/api/media/${id}`, { method: "DELETE", headers: admin })).status).toBe(200);
    expect((await apiFetch(`/api/media/${id}/thumb`)).status).toBe(404);
  });

  it("offers the Amazon cover as a download, and refuses a source that is too small", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
    const big = (await upload(await picture(1000, 1500))).body.asset.id;
    const res = await apiFetch(`/api/media/${big}/book_cover_kdp_ebook?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="cover-kindle.jpg"');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1600, 2560]);
    expect((await apiFetch(`/api/media/${big}/book_cover_shelf`)).headers.get("content-disposition")).toBeNull();

    const small = (await upload(await picture(300, 400))).body.asset.id;
    const refused = await apiFetch(`/api/media/${small}/book_cover_kdp_ebook`);
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toMatch(/at least 625 x 1000/);
  });

  it("uses the fit and focal point staff set", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
    const id = (await upload(await picture(1000, 1000))).body.asset.id;
    const before = await db.storage.from("media").list(`renditions/${id}`);
    expect(before.data).toHaveLength(0);
    await apiFetch(`/api/media/${id}/book_cover_shelf`);
    const patch = await apiFetch(`/api/media/${id}`, { method: "PATCH", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ fits: { book_cover_shelf: "white" }, focal: { x: 0.2, y: 0.8 } }) });
    expect((await patch.json()).asset.fits).toEqual({ book_cover_shelf: "white" });
    await apiFetch(`/api/media/${id}/book_cover_shelf`);
    expect((await db.storage.from("media").list(`renditions/${id}`)).data).toHaveLength(2); // a new object, the old one isn't reused
  });
});

describe("GET, PATCH and DELETE on the library", () => {
  it("lists the shared library for staff and validates edits", async () => {
    const tag = `tag${RUN}`;
    const { body } = await upload(await picture(), { tags: tag, title: `Findable ${RUN}` });
    expect((await apiFetch("/api/media")).status).toBe(401);

    const found = await (await apiFetch(`/api/media?tag=${tag}&limit=5`, { headers: admin })).json();
    expect(found.assets.map((a: { id: string }) => a.id)).toEqual([body.asset.id]);
    const byTitle = await (await apiFetch(`/api/media?q=findable%20${RUN}`, { headers: admin })).json();
    expect(byTitle.assets).toHaveLength(1);

    const patch = (payload: unknown, id = body.asset.id) =>
      apiFetch(`/api/media/${id}`, { method: "PATCH", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect((await (await patch({ title: " Renamed ", alt_text: "", tags: ["A"] })).json()).asset).toMatchObject({ title: "Renamed", alt_text: null, tags: ["a"] });
    expect((await patch({ title: "  " })).status).toBe(400);
    expect((await patch({ tags: [1] })).status).toBe(400);
    expect((await patch({ is_public: "yes" })).status).toBe(400);
    expect((await patch({ focal: { x: 2, y: 0 } })).status).toBe(400);
    expect((await patch({ fits: { nope: "crop" } })).status).toBe(400);
    expect((await patch({ fits: { thumb: "stretch" } })).status).toBe(400);
    expect((await (await patch({ focal: null })).json()).asset.focal_x).toBeNull();
    expect((await patch({ title: "x" }, "img_AAAAAAAAAAAA")).status).toBe(404);
    expect((await patch({ title: "x" }, "bad")).status).toBe(404);
    expect((await apiFetch(`/api/media/img_AAAAAAAAAAAA`, { method: "DELETE", headers: admin })).status).toBe(404);
  });
});
