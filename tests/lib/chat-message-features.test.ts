import { describe, expect, it } from "vitest";
import { messageFeatures } from "@/lib/chat/message-features";

const none = { bold: false, italic: false, underline: false, strike: false, code: false, codeblock: false, quote: false, bullets: false, numbers: false, link: false };

describe("messageFeatures", () => {
  it("finds nothing in plain text, and counts its lines", () => {
    expect(messageFeatures("hello there")).toEqual({ ...none, list_depth: 0, lines: 1, mentions: 0 });
    expect(messageFeatures("one\ntwo\nthree")).toMatchObject({ lines: 3 });
    expect(messageFeatures("")).toMatchObject({ lines: 0 });
  });

  it("finds each mark, however it was written", () => {
    expect(messageFeatures("*bold* and _italic_ and ~struck~")).toMatchObject({ bold: true, italic: true, strike: true, underline: false });
    expect(messageFeatures("<u>underlined</u>")).toMatchObject({ underline: true });
    expect(messageFeatures("some `code` here")).toMatchObject({ code: true });
    expect(messageFeatures("see <https://example.com|the site>")).toMatchObject({ link: true });
  });

  it("finds quotes and code blocks", () => {
    expect(messageFeatures("> a quoted line\nand a reply")).toMatchObject({ quote: true, codeblock: false });
    expect(messageFeatures("```\nconst a = 1;\n```")).toMatchObject({ codeblock: true, code: false });
  });

  it("tells a bullet list from a numbered one, and how deep it nests", () => {
    expect(messageFeatures("• one\n• two")).toMatchObject({ bullets: true, numbers: false, list_depth: 1 });
    expect(messageFeatures("1. one\n2. two")).toMatchObject({ bullets: false, numbers: true, list_depth: 1 });
    expect(messageFeatures("• one\n  • nested\n    • deeper")).toMatchObject({ bullets: true, list_depth: 3 });
    expect(messageFeatures("1. one\n  • nested bullets")).toMatchObject({ bullets: true, numbers: true, list_depth: 2 });
  });

  it("counts people and channels mentioned, and not ordinary angle brackets", () => {
    expect(messageFeatures("hi <@U1> and <@U2>, see <#C1> <!here>")).toMatchObject({ mentions: 4 });
    expect(messageFeatures("1 < 2 and 3 > 2")).toMatchObject({ mentions: 0 });
  });

  it("reports everything at once for a busy message", () => {
    expect(messageFeatures("*Plan*\n> note\n• a\n  • b\nsee <https://example.com>")).toMatchObject({
      bold: true,
      quote: true,
      bullets: true,
      link: true,
      list_depth: 2,
      lines: 5,
    });
  });
});
