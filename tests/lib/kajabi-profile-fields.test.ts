import { describe, it, expect } from "vitest";
import { parseInstagramInput, resolveInstagramUrl, toSocialUrl } from "@/lib/kajabi/profile-fields";

describe("resolveInstagramUrl", () => {
  it("prefers the Instagram Handle custom field over the Kajabi directory socials.instagram", () => {
    expect(resolveInstagramUrl("form_handle", "https://instagram.com/directory_handle")).toBe(
      "https://instagram.com/form_handle"
    );
  });

  it("falls back to socials.instagram when the custom field is empty or blank", () => {
    expect(resolveInstagramUrl(null, "directory_handle")).toBe("https://instagram.com/directory_handle");
    expect(resolveInstagramUrl("   ", "directory_handle")).toBe("https://instagram.com/directory_handle");
  });

  it("is null when neither is set", () => {
    expect(resolveInstagramUrl(null, undefined)).toBeNull();
  });
});

describe("parseInstagramInput", () => {
  it.each([
    ["hedgie_writes", "hedgie_writes"],
    ["@hedgie.writes", "hedgie.writes"],
    ["  @Hedgie  ", "Hedgie"],
    ["https://instagram.com/hedgie_writes", "hedgie_writes"],
    ["https://www.instagram.com/hedgie_writes/", "hedgie_writes"],
    ["http://instagram.com/hedgie?igsh=abc", "hedgie"],
    ["instagram.com/hedgie", "hedgie"],
  ])("normalises %j to handle %j", (input, handle) => {
    expect(parseInstagramInput(input)).toEqual({ handle });
  });

  it("treats blank input as clearing the handle", () => {
    expect(parseInstagramInput("   ")).toEqual({ handle: null });
    expect(parseInstagramInput("")).toEqual({ handle: null });
  });

  it("rejects non-http(s) schemes", () => {
    expect(parseInstagramInput("javascript:alert(1)")).toEqual({ error: expect.stringContaining("http") });
    expect(parseInstagramInput("ftp://instagram.com/hedgie")).toEqual({ error: expect.stringContaining("http") });
  });

  it("rejects links to other sites or non-profile paths", () => {
    expect(parseInstagramInput("https://evil.example.com/hedgie")).toHaveProperty("error");
    expect(parseInstagramInput("https://instagram.com/p/abc123")).toHaveProperty("error");
    expect(parseInstagramInput("https://instagram.com/")).toHaveProperty("error");
  });

  it("rejects invalid handle characters and over-long handles", () => {
    expect(parseInstagramInput("hedgie writes")).toHaveProperty("error");
    expect(parseInstagramInput("hedgie<script>")).toHaveProperty("error");
    expect(parseInstagramInput("a".repeat(31))).toHaveProperty("error");
    expect(parseInstagramInput("a".repeat(30))).toEqual({ handle: "a".repeat(30) });
    expect(parseInstagramInput("x".repeat(201))).toHaveProperty("error");
  });
});

describe("toSocialUrl", () => {
  it("builds a profile URL from a handle and passes full URLs through", () => {
    expect(toSocialUrl("https://instagram.com", "@hedgie")).toBe("https://instagram.com/hedgie");
    expect(toSocialUrl("https://instagram.com", "https://instagram.com/x")).toBe("https://instagram.com/x");
    expect(toSocialUrl("https://instagram.com", null)).toBeNull();
    expect(toSocialUrl("https://instagram.com", "  ")).toBeNull();
  });
});
