import { describe, it, expect } from "vitest";
import { mentionedUserIds, parseInline, parseSlackText } from "@/lib/chat/render";

const text = (v: string) => ({ t: "text", v });

describe("parseInline", () => {
  it("leaves plain text alone and decodes Slack's escapes", () => {
    expect(parseInline("tea &amp; biscuits &lt;3")).toEqual([text("tea & biscuits <3")]);
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
      { t: "special", v: "@here" },
      text(" "),
      { t: "emoji", name: "tada" },
    ]);
    expect(parseInline(":thumbsup::skin-tone-2:")).toEqual([{ t: "emoji", name: "thumbsup" }]);
    expect(parseInline("<!subteam^S1|@editors> <!date^1700000000^{date}|Nov 14>")).toEqual([
      { t: "special", v: "@editors" },
      text(" "),
      text("Nov 14"),
    ]);
  });

  it("does not take a time like 10:30:45 for an emoji", () => {
    expect(parseInline("at 10:30:45 sharp")).toEqual([text("at 10"), { t: "emoji", name: "30" }, text("45 sharp")]);
  });
});

describe("parseSlackText", () => {
  it("splits lines, drops blank ones and reads quotes", () => {
    expect(parseSlackText("one\n\n&gt; quoted *hard*\ntwo")).toEqual([
      { t: "line", c: [text("one")] },
      { t: "quote", c: [text("quoted "), { t: "bold", c: [text("hard")] }] },
      { t: "line", c: [text("two")] },
    ]);
  });

  it("reads code fences and keeps their contents literal", () => {
    expect(parseSlackText("before\n```\nlet a = *1* &amp; 2\n```\nafter")).toEqual([
      { t: "line", c: [text("before")] },
      { t: "code", v: "let a = *1* & 2" },
      { t: "line", c: [text("after")] },
    ]);
  });

  it("treats an unclosed fence as text", () => {
    expect(parseSlackText("oops ``` never closed")).toEqual([{ t: "line", c: [text("oops ``` never closed")] }]);
  });
});

describe("mentionedUserIds", () => {
  it("lists mentioned Slack users, with or without a label", () => {
    expect(mentionedUserIds("<@U1> and <@U2|fern> in <#C1>")).toEqual(["U1", "U2"]);
  });
});
