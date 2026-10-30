import { afterAll, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../helpers/api-fetch";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";
import { solidImage } from "../../helpers/media-fixtures";
import { useFakeClock } from "../../helpers/fake-clock";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createClient: async () => getTestSupabaseAdminClient() };
});
vi.mock("@/lib/supabase/service", async () => {
  const { getTestSupabaseAdminClient } = await import("../../helpers/supabase");
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() };
});

/** The nightly sweep of the media bucket, against the real bucket and table. */
const db = getTestSupabaseAdminClient();
const RUN = Date.now();
const admin = { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
const DAY = 24 * 60 * 60 * 1000;
const assetIds: string[] = [];
const eventIds: string[] = [];
let n = 0;

async function newAsset() {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(await solidImage(60, 40, "png", { r: (RUN + ++n) % 256, g: n * 13, b: (RUN >> 5) % 256 }))], `sweep-${n}.png`));
  const res = await apiFetch("/api/media", { method: "POST", body: form, headers: { authorization: admin.authorization } });
  const asset = (await res.json()).asset as { id: string; storage_path: string };
  assetIds.push(asset.id);
  // A rendition, as the serving route would have cached it.
  await db.storage.from("media").upload(`renditions/${asset.id}/thumb-test.webp`, new Uint8Array([1, 2, 3]), { contentType: "image/webp" });
  return asset;
}
const exists = async (path: string) => !(await db.storage.from("media").download(path)).error;
const sweep = () => apiFetch("/api/reconcile/media", { headers: admin });
const deleteAt = async (id: string, daysAgo: number) => {
  await apiFetch(`/api/media/${id}`, { method: "DELETE", headers: admin });
  await db.from("media_assets").update({ deleted_at: new Date(Date.now() - daysAgo * DAY).toISOString() }).eq("id", id);
};

afterAll(async () => {
  if (eventIds.length) await db.from("events").delete().in("id", eventIds);
  const { data } = await db.from("media_assets").select("storage_path").in("id", assetIds);
  const paths = [...(data ?? []).map((a) => a.storage_path), ...assetIds.map((id) => `renditions/${id}/thumb-test.webp`)];
  await db.storage.from("media").remove(paths);
  await db.from("media_assets").delete().in("id", assetIds);
});

describe("GET /api/reconcile/media", () => {
  const clock = useFakeClock();

  it("needs the cron secret or an admin", async () => {
    expect((await apiFetch("/api/reconcile/media")).status).toBe(401);
  });

  it("removes an upload that was started and never confirmed, once it is over a day old", async () => {
    const start = await (await apiFetch("/api/media/uploads", { method: "POST", headers: admin })).json();
    const put = await db.storage.from("media").uploadToSignedUrl(start.uploadPath, start.token, new Uint8Array([9, 9, 9]), { contentType: "image/png" });
    expect(put.error).toBeNull();

    await sweep();
    expect(await exists(start.uploadPath)).toBe(true); // just made: left alone

    clock.clock.advance(2 * DAY);
    const res = await sweep();
    expect(res.status).toBe(200);
    expect((await res.json()).staleUploads).toBeGreaterThanOrEqual(1);
    expect(await exists(start.uploadPath)).toBe(false);
  });

  it("removes the original and renditions of an image deleted over 30 days ago, and keeps its row", async () => {
    const old = await newAsset();
    const recent = await newAsset();
    const live = await newAsset();
    await deleteAt(old.id, 45);
    await deleteAt(recent.id, 10);

    const body = await (await sweep()).json();
    expect(body).toMatchObject({ success: true, reconciliation: "media" });
    expect(body.assetsCleared).toBeGreaterThanOrEqual(1);

    expect(await exists(old.storage_path)).toBe(false);
    expect(await exists(`renditions/${old.id}/thumb-test.webp`)).toBe(false);
    const row = (await db.from("media_assets").select("title, files_removed_at").eq("id", old.id).single()).data;
    expect(row?.files_removed_at).not.toBeNull();

    for (const kept of [recent, live]) {
      expect(await exists(kept.storage_path)).toBe(true);
      expect(await exists(`renditions/${kept.id}/thumb-test.webp`)).toBe(true);
    }
  });

  it("leaves a deleted image's files alone while an event still shows it", async () => {
    const used = await newAsset();
    const { data: event, error } = await db.from("events").insert({ slug: `sweep-${RUN}`, title: `Sweep ${RUN}`, event_type: "other", starts_at: "2097-08-01", ends_at: "2097-08-01", image_id: used.id }).select("id").single();
    expect(error).toBeNull();
    eventIds.push(event!.id);
    await db.from("media_assets").update({ deleted_at: new Date(Date.now() - 60 * DAY).toISOString() }).eq("id", used.id); // deleted behind the app's back

    const body = await (await sweep()).json();
    expect(body.assetsInUse).toBeGreaterThanOrEqual(1);
    expect(await exists(used.storage_path)).toBe(true);
    expect((await db.from("media_assets").select("files_removed_at").eq("id", used.id).single()).data?.files_removed_at).toBeNull();
  });
});
