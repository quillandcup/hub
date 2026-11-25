import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { removalHash } from "@/lib/data/removal-hash";

describe("removalHash", () => {
  it("is the SHA-256 of the trimmed, lower-cased text, the same value the database computes (removal_hash, pinned in member_removal_kajabi_capture.test.sql)", () => {
    expect(removalHash("ada@example.test")).toBe("b97222ea69dadf792baa97fa768ecb840a0023714c831ab1328838cba9f7f437");
    expect(removalHash("  ADA@example.test ")).toBe(removalHash("ada@example.test"));
    expect(removalHash("kr-lesson-1/c-1")).toBe("f54063fca0b05ed3767052e494260a02bb210bc742d383b49cca0f526ede78bb");
  });

  it("agrees with Node's SHA-256 for empty text, text that fills a block exactly, spills into a second, and non-ASCII text", () => {
    const samples = ["", "a", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(119), "x".repeat(1000), "ünï-cödé@example.test", "名前@example.test"];
    for (const text of samples) expect(removalHash(text)).toBe(createHash("sha256").update(text.trim().toLowerCase(), "utf8").digest("hex"));
  });
});
