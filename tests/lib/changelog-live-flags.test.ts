import { describe, expect, it } from "vitest";
import { LIVE_FLAGS } from "@/lib/changelog/live-flags";
import { FEATURE_PREVIEWS } from "@/lib/features";

describe("LIVE_FLAGS", () => {
  it("names only flags that still exist, so a removed flag's key is deleted here too", () => {
    const keys = new Set<string>(FEATURE_PREVIEWS.map((f) => f.key));
    expect(LIVE_FLAGS.filter((key) => !keys.has(key))).toEqual([]);
  });

  it("has no duplicates", () => {
    expect(new Set(LIVE_FLAGS).size).toBe(LIVE_FLAGS.length);
  });
});
