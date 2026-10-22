import { describe, expect, it } from "vitest";
import { safeImageSrc } from "@/lib/safe-image-src";

describe("safeImageSrc", () => {
  it("keeps blob, https and same-site paths", () => {
    expect(safeImageSrc("blob:http://x/1")).toBe("blob:http://x/1");
    expect(safeImageSrc("https://a.example/b.png")).toBe("https://a.example/b.png");
    expect(safeImageSrc("/api/chat/file/1")).toBe("/api/chat/file/1");
  });
  it("drops other schemes and protocol-relative URLs", () => {
    for (const s of ["javascript:alert(1)", "data:text/html,x", "//evil.example/x", "http://a.example/x"]) expect(safeImageSrc(s)).toBeUndefined();
  });
});
