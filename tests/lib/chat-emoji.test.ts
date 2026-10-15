import { describe, it, expect } from "vitest";
import { unicodeEmoji } from "@/lib/chat/emoji";

describe("unicodeEmoji", () => {
  it("knows Slack's standard shortcodes, including ones outside the small built-in map", () => {
    expect(unicodeEmoji("hedgehog")).toBe("🦔");
    expect(unicodeEmoji("circus_tent")).toBe("🎪");
    expect(unicodeEmoji("hammer_and_wrench")).toContain("🛠");
  });

  it("ignores case and skin tone, and returns null for unknown names", () => {
    expect(unicodeEmoji("Purple_Heart")).toBe("💜");
    expect(unicodeEmoji("thumbsup::skin-tone-3")).toBe(unicodeEmoji("thumbsup"));
    expect(unicodeEmoji("hedgehog-joy")).toBeNull();
  });
});
