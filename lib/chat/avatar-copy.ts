import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { SLACK_AVATAR_BUCKET } from "@/lib/slack-avatar-url";

/**
 * Slack profile photos are served from our own storage, not Slack's CDN, whose URLs are Slack's to change or take
 * down. The Slack import copies each user's photo here. A path is the Slack user id and the content's hash, so a
 * URL never changes under a cached image and a changed photo is a new object; the old one is removed. Server only
 * (sharp checks the bytes are an image).
 */
const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const EXTENSIONS: Record<string, string> = { gif: "gif", png: "png", jpeg: "jpg", webp: "webp" };
const SLACK_USER_ID = /^[A-Z0-9]+$/;

export interface AvatarCopyResult {
  copied: number;
  failed: number;
  removed: number;
}

/**
 * Copies the photos that have no copy yet (or changed), and removes the copies of users who were deactivated or took
 * their photo down. One failure leaves that user on Slack's URL and the rest go on; the next run tries again.
 * `storage` must be a service-role client.
 */
export async function copySlackAvatars(storage: SupabaseClient, fetchImage: typeof fetch = fetch): Promise<AvatarCopyResult> {
  const users = createRepos(storage).slackUsers;
  const bucket = storage.storage.from(SLACK_AVATAR_BUCKET);
  const result: AvatarCopyResult = { copied: 0, failed: 0, removed: 0 };

  for (const { user_id, image_path } of await users.photoCopiesToRemove()) {
    try {
      const { error } = await bucket.remove([image_path]);
      if (error) throw new Error(error.message);
      await users.clearPhotoCopy(user_id, image_path);
      result.removed++;
    } catch (error) {
      result.failed++;
      console.error(`Could not remove the profile photo copy of ${user_id}:`, error instanceof Error ? error.message : error);
    }
  }

  for (const { user_id, image_url, image_path } of await users.photosToCopy()) {
    try {
      if (!SLACK_USER_ID.test(user_id)) throw new Error("unexpected user id");
      if (!image_url.startsWith("https://")) throw new Error("not an https address");
      const response = await fetchImage(image_url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`unexpected size ${bytes.length}`);

      const meta = await sharp(bytes).metadata();
      const ext = meta.format ? EXTENSIONS[meta.format] : undefined;
      if (!ext) throw new Error(`unsupported format ${meta.format}`);
      const path = `${user_id}/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext}`;
      const { error } = await bucket.upload(path, bytes, { contentType: `image/${meta.format}`, upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(`upload ${path}: ${error.message}`);

      await users.markPhotoCopied(user_id, { from: image_url, path });
      // The photo changed: the previous copy is no longer referenced by anything.
      if (image_path && image_path !== path) await bucket.remove([image_path]);
      result.copied++;
    } catch (error) {
      result.failed++;
      console.error(`Could not copy the profile photo of ${user_id}:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
