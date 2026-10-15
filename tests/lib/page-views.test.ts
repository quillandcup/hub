import { describe, it, expect } from "vitest";
import { normalizeTrackedPath } from "@/lib/page-views";

describe("normalizeTrackedPath", () => {
  it("accepts app paths", () => {
    expect(normalizeTrackedPath("/")).toBe("/");
    expect(normalizeTrackedPath("/my-prickles/all")).toBe("/my-prickles/all");
  });

  it("rejects non-strings, relative, protocol-relative and API paths", () => {
    for (const bad of [undefined, null, 5, "dashboard", "//evil.com", "/api", "/api/members", "https://x.com/a"]) {
      expect(normalizeTrackedPath(bad)).toBeNull();
    }
  });

  it("rejects queries, fragments, whitespace and overlong paths", () => {
    for (const bad of ["/a?b=1", "/a#b", "/a b", "/a\\b", "/" + "x".repeat(300)]) {
      expect(normalizeTrackedPath(bad)).toBeNull();
    }
  });
});
