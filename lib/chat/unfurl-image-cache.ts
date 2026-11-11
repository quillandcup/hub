import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { fetchImage, sniffImageType, type FetchImageResult } from "@/lib/net/safe-fetch";

type Storage = Pick<SupabaseClient["storage"], "from">;
type FailureReason = Extract<FetchImageResult, { ok: false }>["reason"];

/** The private bucket (supabase/migrations/20270618000000_unfurl_images_bucket.sql): service role only, raster types, 5 MB. */
export const UNFURL_IMAGE_BUCKET = "unfurl-images";
/** A copy is kept this long, then the nightly sweep removes it and the next viewer fetches it again (so a changed picture shows up). */
export const UNFURL_IMAGE_TTL_DAYS = 7;
/** A host that refused or failed is left alone this long (per server instance), then asked again. */
export const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILURES = 500;
const SWEEP_PAGE = 1000;
const REMOVE_CHUNK = 100;
/** One run removes at most this many; the rest go the following nights. */
const MAX_REMOVED_PER_RUN = 5000;

/** The object name: a hash of the source address, never anything a viewer supplied (the address comes from the message). */
export const unfurlImageKey = (url: string): string => createHash("sha256").update(url).digest("hex");

const failures = new Map<string, { until: number; reason: FailureReason; status?: number }>();
const inflight = new Map<string, Promise<FetchImageResult>>();

/** Test hook: forget what this instance remembers. */
export function resetUnfurlImageMemory(): void {
  failures.clear();
  inflight.clear();
}

function rememberFailure(key: string, reason: FailureReason, status?: number): void {
  const now = clock.now();
  if (failures.size >= MAX_FAILURES) {
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
    // Still full: drop the oldest entry (a Map iterates in insertion order).
    if (failures.size >= MAX_FAILURES) failures.delete(failures.keys().next().value as string);
  }
  failures.set(key, { until: now + FAILURE_TTL_MS, reason, status });
}

/**
 * A picture for the proxy: our stored copy if there is one, else fetched from the other end once (`fetchImage`: public https
 * only, magic-byte sniff, 5 MB) and stored for the next viewer. Only a copy that passed those checks is ever written, with the
 * sniffed type as its content type, and a stored copy is sniffed again on the way out. The caller has already decided this viewer
 * may see the picture: this is only about bytes. Concurrent requests for one address share one fetch. A failed fetch is remembered
 * for `FAILURE_TTL_MS`, not stored. `storage` must be a service-role client's.
 */
export async function cachedUnfurlImage(storage: Storage, url: string, fetcher: typeof fetchImage = fetchImage): Promise<FetchImageResult> {
  const key = unfurlImageKey(url);
  const failed = failures.get(key);
  if (failed) {
    if (failed.until > clock.now()) return { ok: false, reason: failed.reason, detail: "recently failed", status: failed.status };
    failures.delete(key);
  }
  const running = inflight.get(key);
  if (running) return running;

  const job = load(storage, key, url, fetcher).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function load(storage: Storage, key: string, url: string, fetcher: typeof fetchImage): Promise<FetchImageResult> {
  const bucket = storage.from(UNFURL_IMAGE_BUCKET);
  try {
    const { data } = await bucket.download(key);
    if (data) {
      const bytes = Buffer.from(await data.arrayBuffer());
      const contentType = sniffImageType(bytes);
      if (contentType && contentType === data.type) return { ok: true, bytes, contentType };
    }
  } catch (error) {
    console.error("[chat] reading a stored unfurl picture failed:", (error as Error).message);
  }

  const image = await fetcher(url);
  if (!image.ok) {
    rememberFailure(key, image.reason, image.status);
    return image;
  }
  try {
    const { error } = await bucket.upload(key, image.bytes, { contentType: image.contentType, upsert: true });
    if (error) console.error("[chat] storing an unfurl picture failed:", error.message);
  } catch (error) {
    console.error("[chat] storing an unfurl picture failed:", (error as Error).message);
  }
  return image;
}

/**
 * Nightly: remove stored pictures older than `UNFURL_IMAGE_TTL_DAYS`, so the bucket is bounded by a week's worth of distinct
 * pictures. Lists oldest first and stops at the first one still fresh. A failed removal is counted and retried the next night.
 */
export async function sweepUnfurlImages(storage: Storage): Promise<{ removed: number; failed: number }> {
  const bucket = storage.from(UNFURL_IMAGE_BUCKET);
  const cutoff = clock.now() - UNFURL_IMAGE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expired: string[] = [];
  for (let offset = 0; expired.length < MAX_REMOVED_PER_RUN; offset += SWEEP_PAGE) {
    const { data, error } = await bucket.list("", { limit: SWEEP_PAGE, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) throw new Error(`unfurl pictures list failed: ${error.message}`);
    let fresh = false;
    for (const object of data ?? []) {
      if (object.id === null) continue; // a folder
      const created = Date.parse(object.created_at ?? "");
      if (Number.isFinite(created) && created < cutoff) expired.push(object.name);
      else fresh = true;
    }
    if (fresh || !data || data.length < SWEEP_PAGE) break;
  }
  let removed = 0;
  let failed = 0;
  for (let i = 0; i < expired.length; i += REMOVE_CHUNK) {
    const chunk = expired.slice(i, i + REMOVE_CHUNK);
    const { error } = await bucket.remove(chunk);
    if (error) {
      console.error("Couldn't remove expired unfurl pictures:", error.message);
      failed += chunk.length;
    } else {
      removed += chunk.length;
    }
  }
  return { removed, failed };
}
