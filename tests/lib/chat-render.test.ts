import { describe, it, expect } from "vitest";
import { emojiNamesIn, listMarker, markerNumber, MAX_LIST_INDENT, mentionedUserIds, mentionsToPlainText, parseInline, parseSlackText } from "@/lib/chat/render";

const text = (v: string) => ({ t: "text", v });

describe("parseInline", () => {
  it("leaves plain text alone and decodes Slack's escapes", () => {
    expect(parseInline("tea &amp; biscuits &lt;3")).toEqual([text("tea & biscuits "), text("❤️")]);
  });

  it("reads *bold*, _italic_ and ~strike~, nested", () => {
    expect(parseInline("a *b _c_* d")).toEqual([
      text("a "),
      { t: "bold", c: [text("b "), { t: "italic", c: [text("c")] }] },
      text(" d"),
    ]);
    expect(parseInline("~gone~")).toEqual([{ t: "strike", c: [text("gone")] }]);
  });

  it("needs word boundaries and tight markers, so snake_case and maths stay text", () => {
    expect(parseInline("my_file_name 2 * 3 * 4")).toEqual([text("my_file_name 2 * 3 * 4")]);
  });

  it("keeps code literal", () => {
    expect(parseInline("run `*not bold*` now")).toEqual([text("run "), { t: "code", v: "*not bold*" }, text(" now")]);
  });

  it("reads links, with and without labels, and refuses unsafe schemes", () => {
    expect(parseInline("<https://example.test/a?b=1&amp;c=2|the site>")).toEqual([
      { t: "link", href: "https://example.test/a?b=1&c=2", label: "the site" },
    ]);
    expect(parseInline("<https://example.test>")).toEqual([{ t: "link", href: "https://example.test", label: "https://example.test" }]);
    expect(parseInline("<mailto:fern@example.test|Fern>")).toEqual([{ t: "link", href: "mailto:fern@example.test", label: "Fern" }]);
    expect(parseInline("<javascript:alert(1)|click>")).toEqual([text("<javascript:alert(1)|click>")]);
  });

  it("reads mentions, channel links, specials and emoji", () => {
    expect(parseInline("hi <@U123> in <#C456|general> <!here> :tada:")).toEqual([
      text("hi "),
      { t: "user", id: "U123" },
      text(" in "),
      { t: "channel", id: "C456", label: "general" },
      text(" "),
      { t: "special", v: "@here", raw: "here" },
      text(" "),
      { t: "emoji", name: "tada" },
    ]);
    expect(parseInline(":thumbsup::skin-tone-2:")).toEqual([{ t: "emoji", name: "thumbsup" }]);
    expect(parseInline("<!subteam^S1|@editors> <!date^1700000000^{date}|Nov 14>")).toEqual([
      { t: "special", v: "@editors", raw: "subteam^S1" },
      text(" "),
      text("Nov 14"),
    ]);
  });

  it("does not take a time like 10:30:45 for an emoji", () => {
    expect(parseInline("at 10:30:45 sharp")).toEqual([text("at 10:30:45 sharp")]);
  });
});

describe("parseSlackText", () => {
  it("reads a raw > as a quote too, which is how a message written in the Hub keeps it", () => {
    expect(parseSlackText("> quoted\nplain")).toEqual([
      { t: "quote", c: [text("quoted")] },
      { t: "line", c: [text("plain")], gap: false },
    ]);
  });

  it("splits lines, marks a blank line before one as its gap and reads quotes", () => {
    expect(parseSlackText("one\n\n&gt; quoted *hard*\ntwo\n\nthree")).toEqual([
      { t: "line", c: [text("one")], gap: false },
      { t: "quote", c: [text("quoted "), { t: "bold", c: [text("hard")] }] },
      { t: "line", c: [text("two")], gap: false },
      { t: "line", c: [text("three")], gap: true },
    ]);
  });

  it("reads bullet lines", () => {
    expect(parseSlackText("list:\n• one\n• *two*")).toEqual([
      { t: "line", c: [text("list:")], gap: false },
      { t: "bullet", c: [text("one")], indent: 0 },
      { t: "bullet", c: [{ t: "bold", c: [text("two")] }], indent: 0 },
    ]);
  });

  it("reads numbered lines and nested items, however far each is indented, and starts again after a blank line or other text", () => {
    const items = (body: string) => parseSlackText(body).map((b) => (b.t === "bullet" ? `${b.indent}${b.n ?? "•"}` : b.t));
    // Ours indent two spaces, Slack's own text four; the level is how many deeper than the item above, not the width.
    expect(items("1. a\n2. b\n  1. c\n  2. d\n    1. e\n3. f")).toEqual(["01", "02", "11", "12", "21", "03"]);
    expect(items("• a\n    ◦ b\n        ▪ c\n    ◦ d\n• e")).toEqual(["0•", "1•", "2•", "1•", "0•"]);
    expect(items("• a\n\n    • b")).toEqual(["0•", "0•"]);
    expect(items("• a\ntext\n    • b")).toEqual(["0•", "line", "0•"]);
    // Things that look like numbers but aren't list items.
    expect(items("1.5 million\n2024.no space\n3.")).toEqual(["line", "line", "line"]);
  });

  it("reads the nested numbered list Slack writes in its own text, with a. and i. at the levels it uses them", () => {
    const body = "1. an underline\n2. continued until now\n    a. no underline\n    b. under returns\n    c. no more\n3. what\n    a. about\n        i. now\n        ii. then\n            1. deeper\n                a. deepest\n                b. and one more";
    const items = parseSlackText(body).map((b) => (b.t === "bullet" ? `${b.indent}:${b.n}` : b.t));
    expect(items).toEqual(["0:1", "0:2", "1:1", "1:2", "1:3", "0:3", "1:1", "2:1", "2:2", "3:1", "4:1", "4:2"]);
  });

  it("takes a letter or numeral for a marker only inside a list and at the level where Slack uses it", () => {
    const kinds = (body: string) => parseSlackText(body).map((b) => b.t);
    expect(kinds("text\n  a. thing")).toEqual(["line", "line"]);
    expect(kinds("a. thing\n• x")).toEqual(["line", "bullet"]);
    expect(kinds("1. x\n  etc. y\n  i. z")).toEqual(["bullet", "line", "line"]);
    expect(kinds("1. x\n  a. y\n    i. z")).toEqual(["bullet", "bullet", "bullet"]);
    // A numeral that isn't one, or a letter at a level that counts in numbers or numerals.
    expect(kinds("1. x\n  a. y\n    q. z")).toEqual(["bullet", "bullet", "line"]);
    expect(kinds("1. x\n  a. y\n    i. z\n      a. w")).toEqual(["bullet", "bullet", "bullet", "line"]);
    expect([markerNumber("27", 0), markerNumber("b", 1), markerNumber("aa", 4), markerNumber("xiv", 2), markerNumber("b", 2), markerNumber("i", 0), markerNumber("", 2)]).toEqual([27, 2, 27, 14, null, null, null]);
  });

  it("stops at five levels, as Slack does: deeper items stay at the fifth", () => {
    const body = ["• 0", "  • 1", "    • 2", "      • 3", "        • 4", "          • 5", "            • 6"].join("\n");
    expect(parseSlackText(body).map((b) => (b.t === "bullet" ? b.indent : -1))).toEqual([0, 1, 2, 3, 4, 4, 4]);
    expect(MAX_LIST_INDENT).toBe(4);
  });

  it("draws the marker Slack does: •, ◦, ▪ by depth for bullets; 1., a., i. for numbers", () => {
    expect([0, 1, 2, 3, 4].map((indent) => listMarker({ indent }))).toEqual(["•", "◦", "▪", "•", "◦"]);
    expect([0, 1, 2, 3, 4].map((indent) => listMarker({ indent, n: 1 }))).toEqual(["1.", "a.", "i.", "1.", "a."]);
    expect([0, 1, 2].map((indent) => listMarker({ indent, n: 4 }))).toEqual(["4.", "d.", "iv."]);
    expect(listMarker({ indent: 1, n: 27 })).toBe("aa.");
    expect(listMarker({ indent: 2, n: 1994 })).toBe("mcmxciv.");
  });

  it("reads code fences and keeps their contents literal", () => {
    expect(parseSlackText("before\n```\nlet a = *1* &amp; 2\n```\nafter")).toEqual([
      { t: "line", c: [text("before")], gap: false },
      { t: "code", v: "let a = *1* & 2" },
      { t: "line", c: [text("after")], gap: false },
    ]);
  });

  it("treats an unclosed fence as text", () => {
    expect(parseSlackText("oops ``` never closed")).toEqual([{ t: "line", c: [text("oops ``` never closed")], gap: false }]);
  });
});

describe("mentionedUserIds", () => {
  it("lists mentioned Slack users, with or without a label", () => {
    expect(mentionedUserIds("<@U1> and <@U2|fern> in <#C1>")).toEqual(["U1", "U2"]);
  });
});

describe("mentionsToPlainText", () => {
  const names = { userNames: { U1: "Fern" }, channelNames: { C1: "general" } };
  it("replaces user mentions and channel links with names", () => {
    expect(mentionsToPlainText("<@U1> see <#C1|channel>", names)).toBe("@Fern see #general");
  });
  it("leaves out underline markers, which a title or snippet can't draw", () => {
    expect(mentionsToPlainText("see <u>this</u> <@U1>", names)).toBe("see this @Fern");
  });
  it("falls back to the label, then a generic word, for unknown ids", () => {
    expect(mentionsToPlainText("<@U9|moss> <@U8> <#C9|ideas> <#C8>", names)).toBe("@moss @someone #ideas #channel");
  });
});

describe("emojiNamesIn", () => {
  it("lists the shortcodes in a body, lowercased and without skin tones", () => {
    expect(emojiNamesIn(":Hedgehog: :books: :thumbsup::skin-tone-2: :hedgehog-2:")).toEqual(["hedgehog", "books", "thumbsup", "hedgehog-2"]);
  });
});
