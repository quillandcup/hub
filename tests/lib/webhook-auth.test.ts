import { describe, it, expect, afterEach, vi } from "vitest";
import { secretsMatch, webhookSecretRequired } from "@/lib/webhook-auth";

afterEach(() => vi.unstubAllEnvs());

describe("secretsMatch", () => {
  it("accepts the same secret", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
  });

  it.each([["a different secret", "abc124"], ["a longer one", "abc1234"], ["a prefix", "abc"], ["empty", ""], ["null", null], ["undefined", undefined]])(
    "rejects %s",
    (_label, given) => {
      expect(secretsMatch("abc123", given)).toBe(false);
    }
  );
});

describe("webhookSecretRequired", () => {
  it("is required on deployed builds (production and Vercel preview both run NODE_ENV=production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(webhookSecretRequired()).toBe(true);
  });

  it.each(["development", "test"])("is optional in %s", (env) => {
    vi.stubEnv("NODE_ENV", env);
    expect(webhookSecretRequired()).toBe(false);
  });
});
