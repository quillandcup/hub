import { describe, expect, it } from "vitest";
import { MAX_LANDING_BYTES } from "@/lib/landing/json-transfer";
import { SERVER_ACTION_BODY_LIMIT_BYTES } from "@/lib/server-action-limits";

// Vercel answers a function request over 4.5 MB with its own 413 before Next sees it.
const VERCEL_REQUEST_LIMIT_BYTES = 4.5 * 1024 * 1024;
const NEXT_DEFAULT_LIMIT_BYTES = 1024 * 1024;

describe("Server Action body limit (HUB-23)", () => {
  it("is above the page cap with room for multi-byte characters and escaping, so our own check answers first", () => {
    expect(SERVER_ACTION_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(MAX_LANDING_BYTES * 2);
    expect(MAX_LANDING_BYTES).toBeGreaterThan(NEXT_DEFAULT_LIMIT_BYTES);
  });

  it("stays below Vercel's request limit", () => {
    expect(SERVER_ACTION_BODY_LIMIT_BYTES).toBeLessThan(VERCEL_REQUEST_LIMIT_BYTES);
  });

  it("is what next.config.ts hands to Next", async () => {
    const { default: nextConfig } = await import("../../next.config");
    const config = nextConfig as { experimental?: { serverActions?: { bodySizeLimit?: unknown } } };
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe(SERVER_ACTION_BODY_LIMIT_BYTES);
  });
});
