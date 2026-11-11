import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicAddress, safeGet } from "@/lib/net/safe-fetch";

export { isPublicAddress };

/** A cover that is a link to somewhere else is read at most this large, and for at most this long. */
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const OWN_BUCKET = "book-covers";

export type FetchedCover = { bytes: Buffer } | { error: string };

/**
 * The picture behind an older book cover's link. A cover in our own `book-covers` bucket is read from storage;
 * any other link is fetched from the internet through the pinned fetch (`safeGet`, lib/net/safe-fetch.ts) with the
 * care a link a member typed deserves: https only on the usual port (a plain http link is refused), never an address
 * on this machine or a private network, resolved once and connected to by that address so DNS can't change its mind
 * (all checked again on every redirect, of which it follows a few), a size limit and a time limit. What comes back is
 * still only kept if it decodes as an image (`inspectImage`). `storage` needs the service role. Tests swap the name
 * lookup and the socket with `setNetHooks`.
 */
export async function fetchLegacyCover(storage: SupabaseClient["storage"], supabaseUrl: string, coverUrl: string): Promise<FetchedCover> {
  const ownPrefix = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${OWN_BUCKET}/`;
  if (coverUrl.startsWith(ownPrefix)) {
    const { data, error } = await storage.from(OWN_BUCKET).download(decodeURIComponent(coverUrl.slice(ownPrefix.length).split("?")[0]));
    if (error || !data) return { error: "the file is gone from the book-covers bucket" };
    return { bytes: Buffer.from(await data.arrayBuffer()) };
  }

  const got = await safeGet(coverUrl, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, allowHttp: false, accept: "image/*" });
  if (got.ok) return { bytes: got.bytes };
  return { error: got.reason === "too_large" ? `larger than ${MAX_BYTES / (1024 * 1024)} MB` : got.detail };
}
