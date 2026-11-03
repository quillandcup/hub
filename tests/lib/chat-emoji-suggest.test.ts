import { describe, it, expect } from "vitest";
import { emojiChoices, MAX_EMOJI_CHOICES } from "@/lib/chat/emoji-suggest";
import type { StandardEntry } from "@/lib/chat/emoji-catalog";

const std = (name: string, unicode: string, keywords = ""): StandardEntry => ({ name, unicode, category: "people", keywords, tonable: false });
const CATALOG = [
  std("prayer_beads", "📿"),
  std("pray", "🙏", "folded hands"),
  std("place_of_worship", "🛐", "pray worship"),
  std("clap", "👏"),
];

describe("emojiChoices", () => {
  it("is empty without a query", () => {
    expect(emojiChoices("  ", CATALOG, [])).toEqual([]);
  });

  it("puts the exact name first, then names starting with the query, custom ahead of standard, then names or keywords that contain it", () => {
    const custom = [
      { name: "frankenstein-pray", emoji: { url: "https://example.com/f.png" } },
      { name: "pray-hedgie", emoji: { url: "https://example.com/p.png" } },
    ];
    expect(emojiChoices("pray", CATALOG, custom).map((c) => c.name)).toEqual([
      "pray",
      "pray-hedgie",
      "prayer_beads",
      "frankenstein-pray",
      "place_of_worship",
    ]);
  });

  it("lists a name once even when custom and standard share it, and the custom one wins", () => {
    const out = emojiChoices("clap", CATALOG, [{ name: "clap", emoji: { url: "https://example.com/c.png" } }]);
    expect(out).toEqual([{ name: "clap", emoji: { url: "https://example.com/c.png" } }]);
  });

  it("draws a standard emoji as its Unicode, ignores case, and stops at the limit", () => {
    expect(emojiChoices("PRAY", CATALOG, [])[0]).toEqual({ name: "pray", emoji: { text: "🙏" } });
    const many = Array.from({ length: 20 }, (_, i) => std(`smile${i}`, "😀"));
    expect(emojiChoices("smile", many, [])).toHaveLength(MAX_EMOJI_CHOICES);
  });
});
