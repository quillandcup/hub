import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { SLACK_EMOJI_BUCKET } from "@/lib/chat/emoji-url";

/**
 * Custom emoji are served from our own storage, not Slack's CDN: that CDN sends no CORS headers, so the browser
 * can't read an image to make a still of it (Settings > Animations), and its URLs are Slack's to change. The emoji
 * sync copies each image here, with a PNG of the first frame beside an animated one. Paths are the content's hash
 * plus an extension, so a URL never changes under a cached image. Server only (sharp): the URL helper is in emoji-url.ts.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const EXTENSIONS: Record<string, string> = { "image/gif": "gif", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/apng": "png" };

export interface EmojiCopyResult {
  copied: number;
  failed: number;
}

/** Copies the images of the emoji that have none yet (or whose image changed). One failure leaves that emoji on Slack's URL and the rest go on; the next run tries again. `storage` must be a service-role client. */
export async function copyEmojiImages(storage: SupabaseClient, fetchImage: typeof fetch = fetch): Promise<EmojiCopyResult> {
  const workspace = createRepos(storage).slackWorkspace;
  const result: EmojiCopyResult = { copied: 0, failed: 0 };

  for (const { name, image_url } of await workspace.emojiToCopy()) {
    try {
      if (!image_url.startsWith("https://")) throw new Error("not an https address");
      const response = await fetchImage(image_url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`unexpected size ${bytes.length}`);

      const { imagePath, stillPath } = await storeEmojiImage(storage, bytes);

      await workspace.markEmojiCopied(name, { from: image_url, imagePath, stillPath });
      result.copied++;
    } catch (error) {
      result.failed++;
      console.error(`Could not copy custom emoji :${name}:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Stores an image in the emoji bucket, with a still of its first frame when it moves. Throws on a format it can't show. */
export async function storeEmojiImage(storage: SupabaseClient, bytes: Buffer): Promise<{ imagePath: string; stillPath: string | null }> {
  const meta = await sharp(bytes, { animated: true }).metadata();
  const ext = EXTENSIONS[`image/${meta.format}`];
  if (!ext) throw new Error(`unsupported format ${meta.format}`);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const imagePath = `${hash}.${ext}`;
  await upload(storage, imagePath, bytes, `image/${meta.format}`);

  // Only an image with more than one frame needs a still; the first frame is the one every viewer already sees first.
  let stillPath: string | null = null;
  if ((meta.pages ?? 1) > 1) {
    const still = await sharp(bytes, { animated: false }).png().toBuffer();
    stillPath = `${hash}.still.png`;
    await upload(storage, stillPath, still, "image/png");
  }
  return { imagePath, stillPath };
}

async function upload(storage: SupabaseClient, path: string, bytes: Buffer, contentType: string) {
  const { error } = await storage.storage.from(SLACK_EMOJI_BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}
