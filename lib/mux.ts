import Mux from "@mux/mux-node";
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

/** Three short-lived tokens for one lesson view: manifest, poster and seek-preview storyboard. */
export async function signPlaybackTokens(
  mux: Mux,
  playbackId: string,
  expiration = "1h",
): Promise<PlaybackTokens> {
  const tokens = await mux.jwt.signPlaybackId(playbackId, {
    type: [...PLAYBACK_TOKEN_TYPES],
    expiration,
  });
  const playback = tokens["playback-token"];
  const poster = tokens["thumbnail-token"];
  const storyboard = tokens["storyboard-token"];
  if (!playback || !poster || !storyboard) {
    throw new Error("Mux returned fewer playback tokens than requested");
  }
  return { playback, poster, storyboard };
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
