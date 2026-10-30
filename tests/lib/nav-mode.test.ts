import { describe, it, expect } from "vitest";
import { isNavMode, nextNavMode, resolveNavMode } from "@/lib/nav-mode";

describe("nav mode", () => {
  it("accepts only the three modes", () => {
    expect(["open", "closed", "auto"].every(isNavMode)).toBe(true);
    expect(isNavMode("hover")).toBe(false);
    expect(isNavMode(null)).toBe(false);
  });

  it("defaults to auto-hide on chat and pinned open elsewhere, and a saved choice wins", () => {
    expect(resolveNavMode(null, "/chat")).toBe("auto");
    expect(resolveNavMode(undefined, "/chat/chn_x")).toBe("auto");
    expect(resolveNavMode(null, "/dashboard")).toBe("open");
    expect(resolveNavMode("open", "/chat")).toBe("open");
    expect(resolveNavMode("closed", "/dashboard")).toBe("closed");
  });

  it("cycles open, auto, closed", () => {
    expect(nextNavMode("open")).toBe("auto");
    expect(nextNavMode("auto")).toBe("closed");
    expect(nextNavMode("closed")).toBe("open");
  });
});
