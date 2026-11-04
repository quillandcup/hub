import { describe, it, expect } from "vitest";
import { emojiChoices } from "@/lib/chat/emoji-suggest";
import { buildCatalog, type StandardEntry } from "@/lib/chat/emoji-catalog";

const entry = (name: string, unicode: string, tonable: boolean): StandardEntry => ({ name, unicode, category: "people", keywords: "", tonable });

describe("emojiChoices with a skin tone", () => {
  const cat = [entry("clap", "👏", true), entry("tada", "🎉", false)];

  it("draws a skin-tone-capable emoji in the tone, and others unchanged", () => {
    expect(emojiChoices("clap", cat, [], 3)[0].emoji).toEqual({ text: "👏🏼" });
    expect(emojiChoices("tada", cat, [], 3)[0].emoji).toEqual({ text: "🎉" });
  });

  it("stays yellow with no tone chosen", () => {
    expect(emojiChoices("clap", cat, [])[0].emoji).toEqual({ text: "👏" });
  });
});

describe("buildCatalog skin tones", () => {
  const codes = { "1F44F": "clap", "1F91D": "handshake", "1F389": "tada" };
  const skin = (tone: unknown) => ({ tone });
  const data = [
    { hexcode: "1F44F", emoji: "👏", label: "clapping hands", group: 1, skins: [skin(1), skin(2)] },
    { hexcode: "1F91D", emoji: "🤝", label: "handshake", group: 1, skins: [skin([1, 2])] },
    { hexcode: "1F389", emoji: "🎉", label: "party popper", group: 6 },
  ];

  it("marks only single-tone emoji with skin variants as tonable", () => {
    const byName = Object.fromEntries(buildCatalog(data as never, codes).map((e) => [e.name, e.tonable]));
    expect(byName).toEqual({ clap: true, handshake: false, tada: false });
  });
});
