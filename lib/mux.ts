import Mux from "@mux/ts";
import type { CourseMuxApi } from "@/lib/courses/media";

/**
 * Mux helper for course videos (docs/COURSES.md, "Video"). Assets use a signed playback policy,
 * so nothing plays without a token minted here after the caller's access check.
 */

export type MuxVideoQuality = "basic" | "plus" | "premium";

/** The token types one lesson view needs. A token only works for its own type. */
const PLAYBACK_TOKEN_TYPES = ["video", "thumbnail", "storyboard"] as const;

export function createMuxClient(): Mux {
  return new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,
    jwtSigningKey: process.env.MUX_SIGNING_KEY_ID,
    jwtPrivateKey: process.env.MUX_SIGNING_KEY_PRIVATE,
    webhookSecret: process.env.MUX_WEBHOOK_SECRET,
  });
}

/**
 * Create an asset from a URL Mux can fetch (a short-lived link). `videoId` is our `videos.id`,
 * kept on the asset as `passthrough` so a webhook can be traced back even before we've saved the
 * asset id. Playback is signed and capped at 1080p; free auto-captions stay off (the existing
 * videos have captions burned in).
 */
export async function createVideoAsset(
  mux: Mux,
  opts: { url: string; videoId: string; quality: MuxVideoQuality },
): Promise<{ assetId: string }> {
  const asset = await mux.video.assets.create({
    inputs: [{ url: opts.url }],
    playback_policies: ["signed"],
    video_quality: opts.quality,
    max_resolution_tier: "1080p",
    passthrough: opts.videoId,
  });
  return { assetId: asset.id };
}

/**
 * A direct upload: a one-use address the browser sends the file to, so the video never passes through
 * our server. Mux makes the asset when the upload completes (same signed playback and size cap as
 * {@link createVideoAsset}); `corsOrigin` is the page the upload starts from.
 */
export async function createDirectUpload(
  mux: Mux,
  opts: { corsOrigin: string; quality: MuxVideoQuality },
): Promise<{ uploadId: string; url: string }> {
  const upload = await mux.video.uploads.create({
    cors_origin: opts.corsOrigin,
    new_asset_settings: { playback_policies: ["signed"], video_quality: opts.quality, max_resolution_tier: "1080p" },
  });
  if (!upload.url) throw new Error("Mux created an upload with no address");
  return { uploadId: upload.id, url: upload.url };
}

export interface MuxUploadStatus {
  status: "waiting" | "asset_created" | "failed";
  /** The asset Mux made from the file, once the upload is complete. */
  assetId?: string;
}

/** A direct upload's current state, read from Mux (what the webhook would have said). */
export async function getUploadStatus(mux: Mux, uploadId: string): Promise<MuxUploadStatus> {
  const upload = await mux.video.uploads.retrieve(uploadId);
  if (upload.status === "asset_created" && upload.asset_id) return { status: "asset_created", assetId: upload.asset_id };
  return { status: upload.status === "waiting" ? "waiting" : "failed" };
}

/** The upload and asset a `video.upload.asset_created` webhook links, or null for any other event. */
export function uploadAssetFromEvent(event: { type: string; data?: unknown }): { uploadId: string; assetId: string } | null {
  if (event.type !== "video.upload.asset_created") return null;
  const data = event.data as { id?: string; asset_id?: string } | undefined;
  return data?.id && data.asset_id ? { uploadId: data.id, assetId: data.asset_id } : null;
}

export interface MuxAssetStatus {
  status: "preparing" | "ready" | "errored";
  durationSeconds?: number;
  /** The signed playback id, once the asset has one. */
  playbackId?: string;
}

/**
 * An asset's current state, read from Mux. The webhook normally delivers this; reading it is how
 * a deployment without the webhook (a preview, or production before it's set up) catches up.
 */
export async function getAssetStatus(mux: Mux, assetId: string): Promise<MuxAssetStatus> {
  const asset = await mux.video.assets.retrieve(assetId);
  const status = asset.status === "ready" || asset.status === "errored" ? asset.status : "preparing";
  return {
    status,
    durationSeconds: typeof asset.duration === "number" ? asset.duration : undefined,
    playbackId: asset.playback_ids?.find((p) => p.policy === "signed")?.id,
  };
}

export interface PlaybackTokens {
  playback: string;
  poster: string;
  storyboard: string;
}

/**
 * The id of this Mux environment's playback restriction (`MUX_PLAYBACK_RESTRICTION_ID`), or null when
 * unset. The id differs per Mux environment (production, preview/local, checks); `pnpm mux:config:diff`
 * prints it. Not a secret.
 */
export function playbackRestrictionId(): string | null {
  return process.env.MUX_PLAYBACK_RESTRICTION_ID?.trim() || null;
}

/**
 * Three short-lived tokens for one lesson view: manifest, poster and seek-preview storyboard.
 *
 * `restrictionId` (see {@link playbackRestrictionId}) adds Mux's `playback_restriction_id` claim to the
 * **video** token only, which makes Mux enforce the referrer restriction on the stream. Mux supports the
 * claim on every token type, but the stream is what we protect; images stay unrestricted so a thumbnail
 * can never be what a wrong domain list breaks. Without it the tokens are exactly as before.
 */
export async function signPlaybackTokens(
  mux: Mux,
  playbackId: string,
  expiration = "1h",
  restrictionId: string | null = null,
): Promise<PlaybackTokens> {
  const tokens = await mux.jwt.signPlaybackId(playbackId, {
    type: [...PLAYBACK_TOKEN_TYPES],
    expiration,
  });
  const poster = tokens["thumbnail-token"];
  const storyboard = tokens["storyboard-token"];
  const playback = restrictionId
    ? await mux.jwt.signPlaybackId(playbackId, { type: "video", expiration, params: { playback_restriction_id: restrictionId } })
    : tokens["playback-token"];
  if (!playback || !poster || !storyboard) {
    throw new Error("Mux returned fewer playback tokens than requested");
  }
  return { playback, poster, storyboard };
}

/**
 * One signed thumbnail token per moment, for a still of the video at each of `times`. Mux wants a
 * signed thumbnail's options (the time, the width) inside the token's claims, not in the URL, so each
 * moment has its own token and the URL is just `thumbnail.webp?token=...`.
 */
export async function signThumbnailTokens(
  mux: Mux,
  playbackId: string,
  times: number[],
  options: { width?: number; expiration?: string } = {},
): Promise<string[]> {
  const { width = 640, expiration = "1h" } = options;
  return Promise.all(
    times.map((time) =>
      mux.jwt.signPlaybackId(playbackId, { type: "thumbnail", expiration, params: { time: String(Math.round(time * 10) / 10), width: String(width) } }),
    ),
  );
}

/**
 * Verify a webhook's signature and parse it. Throws on a bad or missing signature, an old
 * timestamp, or an unset secret. The body must be the raw text, not re-serialized JSON.
 */
export async function unwrapWebhook(mux: Mux, rawBody: string, headers: Headers) {
  return await mux.webhooks.unwrap(rawBody, headers);
}

export interface MuxAssetUpdate {
  muxAssetId: string;
  status: "ready" | "errored";
  /** Signed playback id, set once the asset is ready. */
  playbackId?: string;
  durationSeconds?: number;
}

/**
 * Reduce an asset webhook to what `videos` stores, or null for events we don't track.
 * Only `video.asset.ready` and `video.asset.errored` change a row.
 */
export function assetUpdateFromEvent(event: {
  type: string;
  data?: unknown;
}): MuxAssetUpdate | null {
  const data = event.data as
    | { id?: string; duration?: number; playback_ids?: { id: string; policy: string }[] }
    | undefined;
  if (!data?.id) return null;
  if (event.type === "video.asset.errored") {
    return { muxAssetId: data.id, status: "errored" };
  }
  if (event.type === "video.asset.ready") {
    const signed = data.playback_ids?.find((p) => p.policy === "signed");
    return {
      muxAssetId: data.id,
      status: "ready",
      playbackId: signed?.id,
      durationSeconds: typeof data.duration === "number" ? data.duration : undefined,
    };
  }
  return null;
}

/** The two Mux calls the course media step makes, over a real client. */
export function courseMuxApi(mux: Mux): CourseMuxApi {
  return {
    createAsset: (opts) => createVideoAsset(mux, opts),
    getAsset: (assetId) => getAssetStatus(mux, assetId),
  };
}
