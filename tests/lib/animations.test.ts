import { describe, expect, it } from "vitest";
import { animationsAllowed, animationsChoice, looksAnimated } from "@/lib/animations";

describe("animationsChoice", () => {
  it("is system unless allow or reduce was stored", () => {
    expect(animationsChoice(null)).toBe("system");
    expect(animationsChoice("allow")).toBe("allow");
    expect(animationsChoice("reduce")).toBe("reduce");
    expect(animationsChoice("junk")).toBe("system");
    expect(animationsChoice("on")).toBe("system");
  });
});

describe("animationsAllowed", () => {
  it("an explicit choice beats the device setting", () => {
    expect(animationsAllowed("reduce", false)).toBe(false);
    expect(animationsAllowed("allow", true)).toBe(true);
  });
  it("system follows the device's reduce-motion setting", () => {
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
