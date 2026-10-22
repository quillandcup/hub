// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildCatalog,
  searchStandard,
  customNames,
  readRecents,
  rememberRecent,
} from "@/lib/chat/emoji-catalog";

const data = [
  { hexcode: "1F44D", emoji: "👍", label: "thumbs up", tags: ["good"], group: 1 },
  { hexcode: "1F44D-1F3FB", emoji: "👍🏻", label: "thumbs up: light", group: 1, tone: 1 },
  { hexcode: "1F600", emoji: "😀", label: "grinning face", tags: ["happy"], group: 0 },
  { hexcode: "1F3FB", emoji: "🏻", label: "light skin tone", group: 2 },
  { hexcode: "1F9FF", emoji: "🧿", label: "nazar", group: 7 },
  { hexcode: "XXXX", emoji: "?", label: "no group" },
];
const codes = { "1F44D": ["+1", "thumbsup"], "1F600": "grinning", "1F3FB": "light" };

beforeEach(() => localStorage.clear());

describe("emoji catalog", () => {
  const catalog = buildCatalog(data, codes);

  it("keeps base emoji that have a Slack shortcode, using the first as the name", () => {
    expect(catalog.map((e) => e.name)).toEqual(["+1", "grinning"]);
    expect(catalog[0].category).toBe("people");
  });

  it("searches names first, then aliases, labels and tags; empty finds nothing", () => {
    expect(searchStandard(catalog, "")).toEqual([]);
    expect(searchStandard(catalog, ":grin:").map((e) => e.name)).toEqual(["grinning"]);
    expect(searchStandard(catalog, "thumbsup").map((e) => e.name)).toEqual(["+1"]);
    expect(searchStandard(catalog, "happy").map((e) => e.name)).toEqual(["grinning"]);
    expect(searchStandard(catalog, "zzz")).toEqual([]);
  });

  it("lists custom names, filtered", () => {
    const custom = { zeta: { url: "u" }, alpha: { text: "x" } };
    expect(customNames(custom)).toEqual(["alpha", "zeta"]);
    expect(customNames(custom, "ZE")).toEqual(["zeta"]);
  });

  it("remembers recents most recent first without repeats, and survives bad storage", () => {
    rememberRecent("a");
    rememberRecent("b");
    rememberRecent("a");
    expect(readRecents()).toEqual(["a", "b"]);
    localStorage.setItem("chat-recent-reactions", "{nope");
    expect(readRecents()).toEqual([]);
    localStorage.setItem("chat-recent-reactions", '{"a":1}');
    expect(readRecents()).toEqual([]);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => rememberRecent("c")).not.toThrow();
    spy.mockRestore();
  });
});
