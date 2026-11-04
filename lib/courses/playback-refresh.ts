/**
 * When a lesson video's playback link has probably expired, and what the player reports about a failure.
 * Links last an hour (lib/mux.ts); a lesson tab left open longer fails the next request with a network
 * error, which a fresh link fixes (/api/courses/playback-tokens).
 */

/** A page open this long since its links were minted is treated as having an expired link (they last 1 hour). */
export const TOKEN_REFRESH_AFTER_MS = 50 * 60 * 1000;

/** The browser's MediaError code for a network error. */
export const MEDIA_ERR_NETWORK = 2;

/**
 * Whether to fetch fresh links and reload the video once: a network error, not already retried, and either the
 * page has been open past the point links expire or the server said the link was refused (401/403). When the page
 * can't say when its links were minted (`mintedAt` null), any network error is worth the one retry.
 */
export function shouldRefreshToken(input: { code: number; status?: number | null; mintedAt: number | null; now: number; alreadyRetried: boolean }): boolean {
  if (input.alreadyRetried || input.code !== MEDIA_ERR_NETWORK) return false;
  if (input.mintedAt === null) return true;
  if (input.status === 401 || input.status === 403) return true;
  return input.now - input.mintedAt >= TOKEN_REFRESH_AFTER_MS;
}

export interface PlaybackErrorInfo {
  code: number;
  /** HTTP status of the request that failed (hls.js players only; a native player doesn't say). */
  status?: number;
  /** hls.js's error detail, such as `manifestLoadError` (hls.js players only). */
  detail?: string;
}

/**
 * What a media element's `error` says. @videojs/hlsjs-video raises a MediaError whose `context` is hls.js's
 * error `details` word and whose `data.response.code` is the HTTP status; a native player gives only the code.
 * Only a bare word and a status number are kept: the error's message and URL can carry the playback token.
 */
export function describePlaybackError(error: unknown): PlaybackErrorInfo {
  const e = (error ?? {}) as { code?: unknown; context?: unknown; data?: { response?: { code?: unknown } } };
  const info: PlaybackErrorInfo = { code: typeof e.code === "number" && Number.isInteger(e.code) && e.code >= 0 && e.code <= 100 ? e.code : 0 };
  if (typeof e.context === "string" && /^[A-Za-z]{1,40}$/.test(e.context)) info.detail = e.context;
  const status = e.data?.response?.code;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) info.status = status;
  return info;
}
