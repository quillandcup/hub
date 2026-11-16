import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValues = vi.hoisted(() => ({ country: null as string | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(headerValues.country ? { "x-vercel-ip-country": headerValues.country } : {}) }));
const optedOut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/opt-out", () => ({ isAnalyticsOptedOut: optedOut }));

import { muxDataMetadata } from "@/lib/mux-data";
import { muxDataConsentFor } from "@/lib/mux-data.server";
import { eventsNeedConsent } from "@/lib/analytics/consent";

describe("muxDataMetadata", () => {
  it("is the lesson title and the player name, nothing about a person", () => {
    expect(muxDataMetadata("Voice")).toEqual({ video_title: "Voice", player_name: "Hub Course player" });
    expect(muxDataMetadata("Voice", "builder").player_name).toBe("Hub Course Builder player");
    expect(muxDataMetadata("Voice", "chat").player_name).toBe("Hub Chat player");
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
    optedOut.mockReset().mockResolvedValue(false);
    headerValues.country = "US";
    vi.stubEnv("NODE_ENV", "production");
  });

  it("is null in sudo", async () => {
    expect(await muxDataConsentFor("u1", { ...member, isSudo: true })).toBeNull();
    expect(optedOut).not.toHaveBeenCalled();
  });

  it("hands over the consent facts for everyone else, no flag needed", async () => {
    headerValues.country = "FR";
    optedOut.mockResolvedValue(true);
    expect(await muxDataConsentFor("u1", member)).toEqual({ needsConsent: true, optedOut: true });
    headerValues.country = "US";
    optedOut.mockResolvedValue(false);
    expect(await muxDataConsentFor("u1", member)).toEqual({ needsConsent: false, optedOut: false });
  });
});
