import { describe, expect, it } from "vitest";
import { describePlaybackError, shouldRefreshToken, TOKEN_REFRESH_AFTER_MS } from "@/lib/courses/playback-refresh";

describe("shouldRefreshToken", () => {
  const base = { code: 2, mintedAt: 1_000, now: 1_000 + TOKEN_REFRESH_AFTER_MS, alreadyRetried: false };

  it("retries a network error once the page is old enough for its links to have expired", () => {
    expect(shouldRefreshToken(base)).toBe(true);
    expect(shouldRefreshToken({ ...base, now: base.now - 1 })).toBe(false);
  });

  it("retries a refused link (401 or 403) at any age", () => {
    expect(shouldRefreshToken({ ...base, now: 1_001, status: 403 })).toBe(true);
    expect(shouldRefreshToken({ ...base, now: 1_001, status: 401 })).toBe(true);
    expect(shouldRefreshToken({ ...base, now: 1_001, status: 500 })).toBe(false);
  });

  it("retries any network error when the page can't say when its links were minted", () => {
    expect(shouldRefreshToken({ ...base, mintedAt: null, now: 5 })).toBe(true);
  });

  it("retries hls.js's own load failures, which arrive as code 0 (a paused tab opened after the link expired)", () => {
    for (const detail of ["levelLoadError", "manifestLoadError", "fragLoadError", "levelLoadTimeOut"]) {
      expect(shouldRefreshToken({ ...base, code: 0, detail })).toBe(true);
    }
    expect(shouldRefreshToken({ ...base, code: 0, detail: "levelLoadError", now: base.now - 1 })).toBe(false);
    expect(shouldRefreshToken({ ...base, code: 0 })).toBe(false);
    expect(shouldRefreshToken({ ...base, code: 0, detail: "bufferAppendError" })).toBe(false);
  });

  it("never retries twice, or an error that isn't a network error", () => {
    expect(shouldRefreshToken({ ...base, alreadyRetried: true })).toBe(false);
    expect(shouldRefreshToken({ ...base, code: 4 })).toBe(false);
    expect(shouldRefreshToken({ ...base, code: 3, mintedAt: null })).toBe(false);
  });
});

describe("describePlaybackError", () => {
  it("reads the code, hls.js's detail word and the HTTP status", () => {
    expect(describePlaybackError({ code: 2, context: "manifestLoadError", data: { response: { code: 403 } } })).toEqual({ code: 2, detail: "manifestLoadError", status: 403 });
  });

  it("gives code 0 when there is no error, and leaves out what a native player doesn't say", () => {
    expect(describePlaybackError(null)).toEqual({ code: 0 });
    expect(describePlaybackError({ code: 4 })).toEqual({ code: 4 });
  });

  it("drops anything that isn't a bare word or a plausible status, which could carry a token", () => {
    const info = describePlaybackError({ code: 9999, context: "https://x/y?token=abc", data: { response: { code: 12 } } });
    expect(info).toEqual({ code: 0 });
  });
});
