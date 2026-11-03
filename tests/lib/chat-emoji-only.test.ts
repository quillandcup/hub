import { describe, it, expect } from "vitest";
import { isEmojiOnly, MAX_JUMBO_EMOJI } from "@/lib/chat/emoji-only";

describe("isEmojiOnly", () => {
  it("is true for emoji and spaces only: plain, toned, joined, flags, keycaps", () => {
    for (const text of ["\u{1F64F}", " \u{1F64F} \u{1F44F} ", "\u{1F44D}\u{1F3FD}", "\u{1F469}‍\u{1F4BB}", "\u{1F1FA}\u{1F1F8}", "1️⃣", "❤️"]) {
      expect(isEmojiOnly(text), text).toBe(true);
    }
  });

  it("is false for text, numbers, nothing, or anything beside the emoji", () => {
    for (const text of ["", "   ", "\u{1F64F} do it", "do it \u{1F64F}", "1", "hi", "\u{1F64F}\n\u{1F64F}x"]) {
      expect(isEmojiOnly(text), text).toBe(false);
    }
  });

  it("counts a :shortcode: only when asked to", () => {
    expect(isEmojiOnly(":pray:")).toBe(false);
    expect(isEmojiOnly(":pray: \u{1F64F} :+1::skin-tone-3:", { shortcodes: true })).toBe(true);
    expect(isEmojiOnly(":pray: hi", { shortcodes: true })).toBe(false);
  });

  it("stops being large past Slack's limit", () => {
    expect(isEmojiOnly("\u{1F64F}".repeat(MAX_JUMBO_EMOJI))).toBe(true);
    expect(isEmojiOnly("\u{1F64F}".repeat(MAX_JUMBO_EMOJI + 1))).toBe(false);
  });
});
