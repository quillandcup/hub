import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValues = vi.hoisted(() => ({ country: null as string | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(headerValues.country ? { "x-vercel-ip-country": headerValues.country } : {}) }));
const own = vi.hoisted(() => vi.fn());
const effective = vi.hoisted(() => vi.fn());
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: own, effectiveMemberHasFeature: effective }));
const optedOut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/opt-out", () => ({ isAnalyticsOptedOut: optedOut }));

import { muxDataMetadata } from "@/lib/mux-data";
import { muxDataConsentFor } from "@/lib/mux-data.server";
import { eventsNeedConsent } from "@/lib/analytics/consent";

describe("muxDataMetadata", () => {
  it("is the lesson title and the player name, nothing about a person", () => {
    expect(muxDataMetadata("Voice")).toEqual({ video_title: "Voice", player_name: "Hub lesson player" });
    expect(Object.keys(muxDataMetadata("x")).some((k) => /viewer|user|email|member|name$/.test(k) && k !== "player_name")).toBe(false);
  });
});

describe("eventsNeedConsent", () => {
  it("needs consent in production for the EU, UK and unknown places, never elsewhere or outside production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(eventsNeedConsent("DE")).toBe(true);
    expect(eventsNeedConsent("GB")).toBe(true);
    expect(eventsNeedConsent(null)).toBe(true);
    expect(eventsNeedConsent("US")).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(eventsNeedConsent("DE")).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("muxDataConsentFor", () => {
  const member = { memberId: "mbr_AAAAAAAAAAA1", isSudo: false };
  beforeEach(() => {
    own.mockReset().mockResolvedValue(["mux_data"]);
    effective.mockReset().mockResolvedValue(true);
    optedOut.mockReset().mockResolvedValue(false);
    headerValues.country = "US";
    vi.stubEnv("NODE_ENV", "production");
  });

  it("is null without the flag, for the effective viewer", async () => {
    effective.mockResolvedValue(false);
    expect(await muxDataConsentFor("u1", member)).toBeNull();
    expect(effective).toHaveBeenCalledWith("mux_data", member, ["mux_data"]);
  });

  it("is null in sudo, whatever the flag says", async () => {
    expect(await muxDataConsentFor("u1", { ...member, isSudo: true })).toBeNull();
    expect(own).not.toHaveBeenCalled();
  });

  it("hands over the consent facts when the flag is on", async () => {
    headerValues.country = "FR";
    optedOut.mockResolvedValue(true);
    expect(await muxDataConsentFor("u1", member)).toEqual({ needsConsent: true, optedOut: true });
    headerValues.country = "US";
    optedOut.mockResolvedValue(false);
    expect(await muxDataConsentFor("u1", member)).toEqual({ needsConsent: false, optedOut: false });
  });
});
