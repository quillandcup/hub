import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../helpers/api-fetch";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { solidImage } from "../../helpers/media-fixtures";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createClient: async () => getTestSupabaseAdminClient() };
});
vi.mock("@/lib/supabase/service", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() };
});

/** An event's cover image: set through the admin event route, listed with the events, and protecting the asset from deletion. */
const db = getTestSupabaseAdminClient();
const RUN = Date.now();
const admin = { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
let eventId: string;
let assetId: string;
let otherAssetId: string;
const assets: string[] = [];
const created: string[] = [];

async function newAsset(n: number) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(await solidImage(120, 80, "png", { r: (RUN + n) % 256, g: n * 9, b: 77 }))], `cover-${n}.png`));
  const res = await apiFetch("/api/media", { method: "POST", body: form, headers: { authorization: admin.authorization } });
  const id = (await res.json()).asset.id as string;
  assets.push(id);
  return id;
}
const patchEvent = (body: unknown) => apiFetch(`/api/admin/events/${eventId}`, { method: "PATCH", headers: admin, body: JSON.stringify(body) });

beforeAll(async () => {
  const { data, error } = await db.from("events").insert({ slug: `cover-${RUN}`, title: `Cover test ${RUN}`, event_type: "other", starts_at: "2097-05-01", ends_at: "2097-05-01" }).select("id").single();
  if (error) throw new Error(error.message);
  eventId = data.id;
  assetId = await newAsset(1);
  otherAssetId = await newAsset(2);
});

afterAll(async () => {
  await db.from("events").delete().in("id", [eventId, ...created]);
  const { data } = await db.from("media_assets").select("storage_path").in("id", assets);
  if (data?.length) await db.storage.from("media").remove(data.map((a) => a.storage_path));
  await db.from("media_assets").delete().in("id", assets);
});

describe("an event's cover image", () => {
  it("is set and cleared through the admin event route, and refuses ids that aren't library assets", async () => {
    const set = await patchEvent({ image_id: assetId });
    expect(set.status).toBe(200);
    expect((await set.json()).event.image_id).toBe(assetId);

    expect((await patchEvent({ image_id: "not-an-id" })).status).toBe(400);
    expect((await patchEvent({ image_id: "media_AAAAAAAAAAAA" })).status).toBe(400); // well-formed, but not in the library
    expect((await db.from("events").select("image_id").eq("id", eventId).single()).data?.image_id).toBe(assetId);

    const swapped = await patchEvent({ image_id: otherAssetId });
    expect((await swapped.json()).event.image_id).toBe(otherAssetId);
    const cleared = await patchEvent({ image_id: null });
    expect((await cleared.json()).event.image_id).toBeNull();
    // An update that doesn't mention the image leaves it alone.
    await patchEvent({ image_id: assetId });
    await patchEvent({ focus: "Writing" });
    expect((await db.from("events").select("image_id").eq("id", eventId).single()).data?.image_id).toBe(assetId);
  });

  it("can be chosen when the event is created, and a bad one is refused before anything is made", async () => {
    const create = (extra: Record<string, unknown>) =>
      apiFetch("/api/admin/events", { method: "POST", headers: admin, body: JSON.stringify({ slug: `made-${RUN}-${created.length}`, title: `Made ${RUN}`, event_type: "other", starts_at: "2097-07-01", ends_at: "2097-07-01", ...extra }) });
    const made = await create({ image_id: otherAssetId });
    expect(made.status).toBe(201);
    const event = (await made.json()).event;
    created.push(event.id);
    expect(event.image_id).toBe(otherAssetId);

    const plain = await create({});
    created.push((await plain.json()).event.id);
    expect((await db.from("events").select("image_id").eq("id", created[created.length - 1]).single()).data?.image_id).toBeNull();

    const before = (await db.from("events").select("id", { count: "exact", head: true }).eq("title", `Made ${RUN}`)).count;
    for (const bad of ["not-an-id", "media_AAAAAAAAAAAA"]) {
      const refused = await create({ image_id: bad });
      expect(refused.status).toBe(400);
    }
    expect((await db.from("events").select("id", { count: "exact", head: true }).eq("title", `Made ${RUN}`)).count).toBe(before);
  });

  it("is carried by the events list, ahead of any imported photo", async () => {
    await patchEvent({ image_id: assetId });
    const listed = (await createRepos(db as unknown as Db).events.listWithCover()).find((e) => e.id === eventId);
    expect(listed).toMatchObject({ imageId: assetId, coverPhotoId: null });
  });

  it("keeps the asset from being deleted while the event shows it, and lets go once it doesn't", async () => {
    await patchEvent({ image_id: assetId });
    const refused = await apiFetch(`/api/media/${assetId}`, { method: "DELETE", headers: admin });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ usages: [{ kind: "event", id: eventId, title: `Cover test ${RUN}` }] });
    expect((await db.from("media_assets").select("deleted_at").eq("id", assetId).single()).data?.deleted_at).toBeNull();

    await patchEvent({ image_id: null });
    expect((await apiFetch(`/api/media/${assetId}`, { method: "DELETE", headers: admin })).status).toBe(200);
  });

  it("is enforced by the database: an asset row an event points at can't be hard-deleted", async () => {
    await patchEvent({ image_id: otherAssetId });
    const { error } = await db.from("media_assets").delete().eq("id", otherAssetId);
    expect(error?.code).toBe("23503");
  });
});
