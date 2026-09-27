import { describe, it, expect } from "vitest";
import { MAX_BIO_LENGTH, parseBioInput, parseFacebookInput, parseXInput } from "@/lib/social-links";
import { applyProfileOverride } from "@/lib/member-profile-overrides";

describe("parseXInput", () => {
  it.each([
    ["hedgie_writes", "https://x.com/hedgie_writes"],
    ["@hedgie", "https://x.com/hedgie"],
    ["https://twitter.com/hedgie", "https://x.com/hedgie"],
    ["https://x.com/hedgie/", "https://x.com/hedgie"],
    ["mobile.twitter.com/hedgie", "https://x.com/hedgie"],
  ])("normalises %j to %j", (input, url) => {
    expect(parseXInput(input)).toEqual({ url });
  });

  it("clears on blank input", () => {
    expect(parseXInput("  ")).toEqual({ url: null });
  });

  it("rejects bad handles, other sites and non-http schemes", () => {
    expect(parseXInput("a".repeat(16))).toHaveProperty("error");
    expect(parseXInput("hedgie.writes")).toHaveProperty("error");
    expect(parseXInput("https://facebook.com/hedgie")).toEqual({ error: expect.stringContaining("x.com") });
    expect(parseXInput("javascript:alert(1)")).toEqual({ error: expect.stringContaining("http") });
    expect(parseXInput("https://x.com/hedgie/status/123")).toHaveProperty("error");
  });
});

describe("parseFacebookInput", () => {
  it.each([
    ["hedgie.writes", "https://facebook.com/hedgie.writes"],
    ["https://www.facebook.com/hedgie.writes/", "https://facebook.com/hedgie.writes"],
    ["https://m.facebook.com/hedgiewrites", "https://facebook.com/hedgiewrites"],
    ["fb.com/hedgiewrites", "https://facebook.com/hedgiewrites"],
    ["https://www.facebook.com/profile.php?id=100012345678", "https://facebook.com/profile.php?id=100012345678"],
  ])("normalises %j to %j", (input, url) => {
    expect(parseFacebookInput(input)).toEqual({ url });
  });

  it("clears on blank input", () => {
    expect(parseFacebookInput("")).toEqual({ url: null });
  });

  it("rejects short/invalid usernames and non-Facebook links", () => {
    expect(parseFacebookInput("abc")).toHaveProperty("error");
    expect(parseFacebookInput("hedgie_writes")).toHaveProperty("error");
    expect(parseFacebookInput("https://evil.example.com/hedgiewrites")).toHaveProperty("error");
    expect(parseFacebookInput("data:text/html,hi")).toHaveProperty("error");
  });
});

describe("parseBioInput", () => {
  it("trims and normalises line endings", () => {
    expect(parseBioInput("  Hello\r\nworld  ")).toEqual({ bio: "Hello\nworld" });
  });

  it("clears on blank input", () => {
    expect(parseBioInput(" \n ")).toEqual({ bio: null });
  });

  it("enforces the length limit", () => {
    expect(parseBioInput("a".repeat(MAX_BIO_LENGTH))).toEqual({ bio: "a".repeat(MAX_BIO_LENGTH) });
    expect(parseBioInput("a".repeat(MAX_BIO_LENGTH + 1))).toHaveProperty("error");
  });
});

describe("applyProfileOverride", () => {
  const kajabi = { bio: "Kajabi bio", facebook_url: "https://facebook.com/kajabi", twitter_url: null };

  it("prefers non-empty overrides field by field", () => {
    expect(applyProfileOverride(kajabi, { bio: "My bio", facebook_url: null, twitter_url: "https://x.com/me" })).toEqual({
      bio: "My bio",
      facebook_url: "https://facebook.com/kajabi",
      twitter_url: "https://x.com/me",
    });
  });

  it("falls back to Kajabi for null/blank overrides or no override row", () => {
    expect(applyProfileOverride(kajabi, { bio: "  ", facebook_url: null, twitter_url: null })).toEqual(kajabi);
    expect(applyProfileOverride(kajabi, null)).toEqual(kajabi);
  });
});
