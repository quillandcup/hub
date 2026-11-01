import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../helpers/api-fetch";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { insertEvent } from "../../helpers/event-db";
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

/** A photo from an event's gallery used as a library image: copied once, remembered by its source, gallery untouched. */
const db = getTestSupabaseAdminClient();
const RUN = Date.now();
const admin = { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
const post = (body: unknown, headers: Record<string, string> = admin) => apiFetch("/api/media/from-event-photo", { method: "POST", headers, body: JSON.stringify(body) });

let eventId: string;
let photoId: string;
let missingFileId: string;
const photoPath = (name: string) => `from-photo-${RUN}/${name}.png`;
const assetIds: string[] = [];

beforeAll(async () => {
  const { data: event, error } = await insertEvent(db, { slug: `from-photo-${RUN}`, title: `Spring Retreat ${RUN}`, starts_at: "2097-06-01" });
  if (error) throw new Error(error.message);
  eventId = event!.id;
  const bytes = await solidImage(640, 360, "png", { r: RUN % 256, g: 90, b: 140 });
  await db.storage.from("event-photos").upload(photoPath("a"), bytes, { contentType: "image/png", upsert: true });
  const { data: photos, error: photoError } = await db
    .from("event_photos")
    .insert([
      { event_id: eventId, storage_path: photoPath("a"), google_media_item_id: `gm-a-${RUN}`, mime_type: "image/png" },
      { event_id: eventId, storage_path: photoPath("gone"), google_media_item_id: `gm-gone-${RUN}`, mime_type: "image/png" },
    ])
    .select("id, google_media_item_id");
  if (photoError) throw new Error(photoError.message);
  photoId = photos.find((p) => p.google_media_item_id === `gm-a-${RUN}`)!.id;
  missingFileId = photos.find((p) => p.google_media_item_id === `gm-gone-${RUN}`)!.id;
});

afterAll(async () => {
  await db.from("community_events").delete().eq("id", eventId); // its photo rows go with it
  await db.storage.from("event-photos").remove([photoPath("a")]);
  const { data } = await db.from("media_assets").select("storage_path").in("id", assetIds);
  if (data?.length) await db.storage.from("media").remove(data.map((a) => a.storage_path));
  await db.from("media_assets").delete().in("id", assetIds);
});

describe("POST /api/media/from-event-photo", () => {
  it("needs an admin and a well-formed body", async () => {
    expect((await post({ eventId, photoId }, { "content-type": "application/json" })).status).toBe(401);
    expect((await post({ eventId })).status).toBe(400);
    const malformed = await apiFetch("/api/media/from-event-photo", { method: "POST", headers: admin, body: "{nope" });
    expect(malformed.status).toBe(400);
  });

  it("copies the photo into the library, titled after the event, and answers 200 with the same asset the second time", async () => {
    const first = await post({ eventId, photoId });
    expect(first.status).toBe(201);
    const { asset } = await first.json();
    assetIds.push(asset.id);
    expect(asset).toMatchObject({ title: `Spring Retreat ${RUN} photo`, source: "event_photo", source_key: `${eventId}/${photoId}`, width: 640, height: 360, owner_member_id: null });

    const second = await post({ eventId, photoId });
    expect(second.status).toBe(200);
    expect((await second.json()).asset.id).toBe(asset.id);

    const gallery = await db.storage.from("event-photos").download(photoPath("a"));
    expect(gallery.data).toBeTruthy(); // the gallery's copy is still there
  });

  it("answers 404 for a photo that isn't this event's, and 502 when its file is missing", async () => {
    expect((await post({ eventId, photoId: "11111111-1111-4111-8111-111111111111" })).status).toBe(404);
    expect((await post({ eventId: "11111111-1111-4111-8111-111111111111", photoId })).status).toBe(404);
    expect((await post({ eventId, photoId: missingFileId })).status).toBe(502);
  });
});
