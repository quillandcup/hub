import { describe, expect, it } from "vitest";
import { animationsAllowed, looksAnimated } from "@/lib/animations";

describe("animationsAllowed", () => {
  it("an explicit choice beats the device setting", () => {
    expect(animationsAllowed("off", false)).toBe(false);
    expect(animationsAllowed("on", true)).toBe(true);
  });
  it("follows reduce-motion until chosen", () => {
    expect(animationsAllowed(null, true)).toBe(false);
    expect(animationsAllowed(null, false)).toBe(true);
    expect(animationsAllowed("junk", true)).toBe(false);
  });
});

describe("looksAnimated", () => {
  it("matches moving formats, ignoring the query string", () => {
    expect(looksAnimated("https://x.test/party.gif?v=2")).toBe(true);
    expect(looksAnimated("https://x.test/a.WEBP")).toBe(true);
    expect(looksAnimated("https://x.test/a.png")).toBe(false);
  });
});
