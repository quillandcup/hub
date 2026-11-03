import { describe, it, expect } from "vitest";
import { convertEmoticonBefore } from "@/lib/chat/emoticons";
import { applyPastedMentions, pastedNameCandidates } from "@/lib/chat/paste-mentions";
import { emojiNamesIn, parseInline, toEditableText } from "@/lib/chat/render";

const names = { userNames: {}, channelNames: {} };

describe("emoticons while typing", () => {
  it("converts after a space or punctuation", () => {
    expect(convertEmoticonBefore("hi :) ", 6)).toEqual({ value: "hi 🙂 ", caret: 6 });
    expect(convertEmoticonBefore(":'(.", 4)?.value).toBe("😢.");
    expect(convertEmoticonBefore("<3 ", 3)?.value).toBe("❤️ ");
  });
  it("leaves URLs, times, words and code alone", () => {
    expect(convertEmoticonBefore("http:// ", 8)).toBeNull();
    expect(convertEmoticonBefore("at 10:30 ", 9)).toBeNull();
    expect(convertEmoticonBefore("a:) ", 4)).toBeNull();
    expect(convertEmoticonBefore("`x :) ", 6)).toBeNull();
    expect(convertEmoticonBefore("hi :)", 5)).toBeNull();
  });
});

describe("emoticons in messages", () => {
  it("draws them as emoji", () => {
    expect(parseInline("so happy :) really")).toEqual([{ t: "text", v: "so happy " }, { t: "text", v: "🙂" }, { t: "text", v: " really" }]);
    expect(parseInline("sad :'(").some((n) => n.t === "text" && n.v === "😢")).toBe(true);
    expect(parseInline("love &lt;3").some((n) => n.t === "text" && n.v === "❤️")).toBe(true);
  });
  it("ignores URLs, times and code spans", () => {
    expect(parseInline("see http://x.com at 10:30")).toEqual([{ t: "text", v: "see http://x.com at 10:30" }]);
    expect(parseInline("`:)`")).toEqual([{ t: "code", v: ":)" }]);
  });
});

describe("editing shows emoji, not shortcodes", () => {
  it("turns standard shortcodes into the emoji and keeps custom ones and code", () => {
    expect(toEditableText("thanks :pray: and :partyparrot: `:pray:`", { ...names, customEmoji: { partyparrot: { url: "u" } } }).text).toBe("thanks 🙏 and :partyparrot: `:pray:`");
  });
});

describe("pasted mentions", () => {
  const ania = { label: "@Ania Ray", token: "<@U1>" };
  const sam = { label: "@Sam Lee", token: "<@U2>" };
  it("lists candidate names, longest first", () => {
    expect(pastedNameCandidates("@Ania Ray @Sam")).toContain("Ania Ray");
  });
  it("converts exact full names and leaves the rest", () => {
    const r = applyPastedMentions("@Ania Ray, @sam lee and @Nobody Here", [ania, sam]);
    expect(r.text).toBe("@Ania Ray, @Sam Lee and @Nobody Here");
    expect([...r.picked]).toEqual([
      ["@Ania Ray", "<@U1>"],
      ["@Sam Lee", "<@U2>"],
    ]);
  });
  it("skips ambiguous names", () => {
    const r = applyPastedMentions("@Sam Lee", [sam, { label: "@Sam Lee", token: "<@U3>" }]);
    expect(r.picked.size).toBe(0);
  });
});

describe("addresses are not emoji shortcodes", () => {
  it("leaves the :ab: and :cd: inside an IPv6 address or MAC alone, in messages and the edit box", () => {
    const v6 = "fe80::ab:cd:ef and 2001:db8::ab:cd:1";
    expect(parseInline(v6)).toEqual([{ t: "text", v: v6 }]);
    expect(toEditableText(v6, names).text).toBe(v6);
    expect(emojiNamesIn(v6)).toEqual([]);
  });
  it("still draws adjacent and spaced shortcodes", () => {
    expect(parseInline("hi :cd: :ab::ok:").filter((n) => n.t === "emoji").length).toBe(3);
  });
});
