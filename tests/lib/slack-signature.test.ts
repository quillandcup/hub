import { describe, it, expect, afterEach, vi } from "vitest";
import { createHmac } from "crypto";
import { verifySlackSignature } from "@/lib/slack-signature";

const SECRET = "test-signing-secret";
const BODY = "token=x&command=%2Fhub";
const now = () => String(Math.floor(Date.now() / 1000));
const sign = (timestamp: string, body = BODY) =>
  "v0=" + createHmac("sha256", SECRET).update(`v0:${timestamp}:${body}`).digest("hex");

afterEach(() => vi.unstubAllEnvs());

describe("verifySlackSignature", () => {
  it("accepts a correctly signed, recent request", () => {
    const ts = now();
    expect(verifySlackSignature(BODY, sign(ts), ts, SECRET)).toEqual({ valid: true });
  });

  it("rejects a tampered body, a missing header and an old timestamp", () => {
    const ts = now();
    expect(verifySlackSignature(BODY + "x", sign(ts), ts, SECRET)).toEqual({ valid: false, reason: "mismatch" });
    expect(verifySlackSignature(BODY, null, ts, SECRET)).toEqual({ valid: false, reason: "missing" });
    const old = String(Math.floor(Date.now() / 1000) - 60 * 10);
    expect(verifySlackSignature(BODY, sign(old), old, SECRET)).toEqual({ valid: false, reason: "too_old" });
  });

  describe("with no signing secret", () => {
    it("skips verification locally and in tests, so webhooks can be tried without configuring Slack", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(verifySlackSignature(BODY, null, null, undefined)).toEqual({ valid: true });
      vi.stubEnv("NODE_ENV", "test");
      expect(verifySlackSignature(BODY, null, null, "")).toEqual({ valid: true });
    });

    it("rejects everything on a deployed build, so a missing secret can't switch the check off", () => {
      vi.stubEnv("NODE_ENV", "production");
      const ts = now();
      expect(verifySlackSignature(BODY, sign(ts), ts, undefined)).toEqual({ valid: false, reason: "not_configured" });
      expect(verifySlackSignature(BODY, null, null, "")).toEqual({ valid: false, reason: "not_configured" });
    });
  });
});
