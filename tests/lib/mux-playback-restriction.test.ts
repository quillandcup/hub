import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Mux from "@mux/ts";
import { playbackRestrictionId, signPlaybackTokens } from "@/lib/mux";
import { restrictionIdForViewer } from "@/lib/mux-restriction.server";
import { restrictionEnvAdvice, restrictionEnvLine } from "@/lib/mux-config";
import type { FeatureKey } from "@/lib/features";

const own = vi.fn<(userId: string) => Promise<FeatureKey[]>>();
const effective = vi.fn();
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: (userId: string) => own(userId),
  effectiveMemberHasFeature: (...a: unknown[]) => effective(...a),
}));

const fakeMux = () => {
  const signPlaybackId = vi.fn(async (_id: string, config: { type: string | string[] }) =>
    Array.isArray(config.type)
      ? { "playback-token": "plain-video", "thumbnail-token": "thumb", "storyboard-token": "board" }
      : "restricted-video",
  );
  return { mux: { jwt: { signPlaybackId } } as unknown as Mux, signPlaybackId };
};

describe("signPlaybackTokens with a restriction", () => {
  it("is exactly the old behavior without a restriction id", async () => {
    const { mux, signPlaybackId } = fakeMux();
    expect(await signPlaybackTokens(mux, "pb-1")).toEqual({ playback: "plain-video", poster: "thumb", storyboard: "board" });
    expect(signPlaybackId).toHaveBeenCalledTimes(1);
    expect(signPlaybackId).toHaveBeenCalledWith("pb-1", { type: ["video", "thumbnail", "storyboard"], expiration: "1h" });
  });

  it("puts the claim on the video token only; poster and storyboard are unchanged", async () => {
    const { mux, signPlaybackId } = fakeMux();
    const tokens = await signPlaybackTokens(mux, "pb-1", "2h", "res-1");
    expect(tokens).toEqual({ playback: "restricted-video", poster: "thumb", storyboard: "board" });
    expect(signPlaybackId).toHaveBeenCalledWith("pb-1", { type: ["video", "thumbnail", "storyboard"], expiration: "2h" });
    expect(signPlaybackId).toHaveBeenCalledWith("pb-1", { type: "video", expiration: "2h", params: { playback_restriction_id: "res-1" } });
  });
});

describe("playbackRestrictionId", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reads the env var, trimmed", () => {
    vi.stubEnv("MUX_PLAYBACK_RESTRICTION_ID", "  res-1 ");
    expect(playbackRestrictionId()).toBe("res-1");
  });
  it("is null (enforcement off) when unset or blank, never a fallback", () => {
    vi.stubEnv("MUX_PLAYBACK_RESTRICTION_ID", "");
    expect(playbackRestrictionId()).toBeNull();
    vi.stubEnv("MUX_PLAYBACK_RESTRICTION_ID", "   ");
    expect(playbackRestrictionId()).toBeNull();
  });
});

describe("restrictionIdForViewer: flag and env var", () => {
  const identity = { memberId: "mbr_AAAAAAAAAAA1", isSudo: false };
  beforeEach(() => {
    own.mockReset();
    effective.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { flag: true, id: "res-1", expected: "res-1" },
    { flag: true, id: "", expected: null },
    { flag: false, id: "res-1", expected: null },
    { flag: false, id: "", expected: null },
  ])("flag $flag, id '$id' -> $expected", async ({ flag, id, expected }) => {
    vi.stubEnv("MUX_PLAYBACK_RESTRICTION_ID", id);
    own.mockResolvedValue(flag ? ["mux_playback_restriction"] : []);
    effective.mockImplementation(async (key: FeatureKey, _i: unknown, features: FeatureKey[]) => features.includes(key));
    expect(await restrictionIdForViewer("user-1", identity)).toBe(expected);
  });

  it("does not look the flag up where the env var is unset", async () => {
    vi.stubEnv("MUX_PLAYBACK_RESTRICTION_ID", "");
    await restrictionIdForViewer("user-1", identity);
    expect(own).not.toHaveBeenCalled();
  });

  it("asks about the effective member in sudo", async () => {
    vi.stubEnv("MUX_PLAYBACK_RESTRICTION_ID", "res-1");
    const sudo = { memberId: "mbr_BBBBBBBBBBB2", isSudo: true };
    own.mockResolvedValue(["mux_playback_restriction"]);
    effective.mockResolvedValue(false);
    expect(await restrictionIdForViewer("admin-user", sudo)).toBeNull();
    expect(effective).toHaveBeenCalledWith("mux_playback_restriction", sudo, ["mux_playback_restriction"]);
  });

  it("uses the user's own flags when there is no member identity", async () => {
    vi.stubEnv("MUX_PLAYBACK_RESTRICTION_ID", "res-1");
    own.mockResolvedValue(["mux_playback_restriction"]);
    expect(await restrictionIdForViewer("user-1", null)).toBe("res-1");
    expect(effective).not.toHaveBeenCalled();
  });
});

describe("restrictionEnvAdvice", () => {
  it("prints the line to add when unset", () => {
    expect(restrictionEnvLine("res-1")).toBe("MUX_PLAYBACK_RESTRICTION_ID=res-1");
    expect(restrictionEnvAdvice("res-1", undefined)).toContain("add this line to the env file: MUX_PLAYBACK_RESTRICTION_ID=res-1");
    expect(restrictionEnvAdvice("res-1", " ")).toContain("MUX_PLAYBACK_RESTRICTION_ID=res-1");
  });
  it("says nothing more when it matches, and warns when it differs", () => {
    expect(restrictionEnvAdvice("res-1", "res-1")).toBeNull();
    expect(restrictionEnvAdvice("res-1", "other")).toContain("not the live restriction's id");
  });
});
