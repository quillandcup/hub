// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { baseName, readTone, toneOf, tonedUnicode, withTone, writeTone } from "@/lib/chat/skin-tone";

beforeEach(() => localStorage.clear());

describe("skin tones", () => {
  it("reads and writes the Slack suffix", () => {
    expect(toneOf("+1::skin-tone-3")).toBe(3);
    expect(toneOf("+1")).toBeNull();
    expect(baseName("+1::SKIN-tone-3")).toBe("+1");
    expect(withTone("wave", 4)).toBe("wave::skin-tone-4");
    expect(withTone("wave", null)).toBe("wave");
  });

  it("puts the modifier after the first character, dropping a variation selector", () => {
    expect(tonedUnicode("👍", 2)).toBe("👍🏻");
    expect(tonedUnicode("👍", 6)).toBe("👍🏿");
    expect(tonedUnicode("☝️", 4)).toBe("☝🏽");
    expect(tonedUnicode("🧑‍💻", 3)).toBe("🧑🏼‍💻");
  });

  it("remembers the tone per browser and ignores bad or unavailable storage", () => {
    expect(readTone()).toBeNull();
    writeTone(5);
    expect(readTone()).toBe(5);
    localStorage.setItem("chat-skin-tone", "9");
    expect(readTone()).toBeNull();
    writeTone(null);
    expect(localStorage.getItem("chat-skin-tone")).toBeNull();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readTone()).toBeNull();
    expect(() => writeTone(2)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
