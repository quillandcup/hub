import { describe, it, expect } from "vitest";
import { blocksToBody, bodyToBlocks, hasUnderline, stripUnderline, type RichTextBlock } from "@/lib/chat/rich-blocks";

const section = (...elements: object[]) => ({ type: "rich_text_section", elements });
const text = (t: string, style?: object) => ({ type: "text", text: t, ...(style ? { style } : {}) });
const rich = (...elements: object[]) => [{ type: "rich_text", elements }];

describe("hasUnderline / stripUnderline", () => {
  it("finds an underlined run and removes just the markers", () => {
    expect(hasUnderline("a <u>b</u> c")).toBe(true);
    expect(hasUnderline("a <u></u> <u>unclosed and *bold*")).toBe(false);
    expect(hasUnderline("plain <b>")).toBe(false);
    expect(stripUnderline("a <u>b *c*</u> d")).toBe("a b *c* d");
  });
});

describe("bodyToBlocks", () => {
  it("turns each style, nested ones together, into the element's style flags", () => {
    expect(bodyToBlocks("a <u>under</u> *<u>both</u>* ~x~ _i_ `c`", { plain: true })).toEqual(
      rich(
        section(
          text("a "),
          text("under", { underline: true }),
          text(" "),
          text("both", { underline: true, bold: true }),
          text(" "),
          text("x", { strike: true }),
          text(" "),
          text("i", { italic: true }),
          text(" "),
          text("c", { code: true })
        )
      )
    );
  });

  it("keeps links, people, channels, broadcasts, user groups and emoji as their own elements", () => {
    const [block] = bodyToBlocks("<u>hi</u> <@U1> <#C1> <https://x.test|the doc> <https://y.test> :hedgie: <!here> <!subteam^S1|@team> <!date^1|when>", { plain: false });
    const kinds = (block as RichTextBlock).elements[0].elements.map((e) => (e as { type: string }).type);
    expect(kinds).toEqual(["text", "text", "user", "text", "channel", "text", "link", "text", "link", "text", "emoji", "text", "broadcast", "text", "usergroup", "text", "text"]);
    const els = (block as RichTextBlock).elements[0].elements as Record<string, unknown>[];
    expect(els[2]).toEqual({ type: "user", user_id: "U1" });
    expect(els[6]).toEqual({ type: "link", url: "https://x.test", text: "the doc" });
    expect(els[8]).toEqual({ type: "link", url: "https://y.test" });
    expect(els[10]).toEqual({ type: "emoji", name: "hedgie" });
    expect(els[12]).toEqual({ type: "broadcast", range: "here" });
    expect(els[14]).toEqual({ type: "usergroup", usergroup_id: "S1" });
  });

  it("makes lines, blank lines, bullet lists, quotes and code blocks from the lines of the body", () => {
    const [block] = bodyToBlocks("one\n\ntwo <u>u</u>\n• a\n• b\n> q1\n> q2\n```\nlet x = 1\n```", { plain: true });
    expect(block.elements.map((e) => e.type)).toEqual(["rich_text_section", "rich_text_list", "rich_text_quote", "rich_text_preformatted"]);
    expect(block.elements[0]).toEqual(section(text("one"), text("\n\n"), text("two "), text("u", { underline: true })));
    expect(block.elements[1]).toMatchObject({ style: "bullet", indent: 0, elements: [section(text("a")), section(text("b"))] });
    expect(block.elements[2]).toEqual({ type: "rich_text_quote", elements: [text("q1"), text("\n"), text("q2")] });
    expect(block.elements[3]).toEqual({ type: "rich_text_preformatted", elements: [text("let x = 1")] });
  });

  it("reads a Hub body as plain text (what is typed is what is sent) and a Slack body as Slack's escapes", () => {
    expect(bodyToBlocks("a < b & c <u>d</u>", { plain: true })[0].elements[0]).toEqual(section(text("a < b & c "), text("d", { underline: true })));
    expect(bodyToBlocks("a &lt; b &amp; c <u>d</u>", { plain: false })[0].elements[0]).toEqual(section(text("a < b & c "), text("d", { underline: true })));
  });
});

describe("blocksToBody", () => {
  it("is null unless something is underlined, so every other message keeps its own text", () => {
    expect(blocksToBody(rich(section(text("hi", { bold: true }))), { plain: true })).toBeNull();
    expect(blocksToBody(null, { plain: true })).toBeNull();
    expect(blocksToBody("nonsense", { plain: false })).toBeNull();
  });

  it("writes every style, innermost first, with the markers against the words, and joins neighbouring underlines", () => {
    const blocks = rich(
      section(
        text("a "),
        text("ab ", { underline: true, bold: true }),
        text("cd", { underline: true }),
        text(" "),
        text("x", { code: true, italic: true }),
        text(" "),
        text("s", { strike: true })
      )
    );
    expect(blocksToBody(blocks, { plain: true })).toBe("a <u>*ab* cd</u> _`x`_ ~s~");
  });

  it("writes links, people, channels, groups, broadcasts, emoji and dates as Slack's tokens", () => {
    const blocks = rich(
      section(
        text("u", { underline: true }),
        { type: "user", user_id: "U1" },
        { type: "channel", channel_id: "C1" },
        { type: "link", url: "https://x.test/?a=1&b=2", text: "the doc" },
        { type: "link", url: "https://y.test" },
        { type: "emoji", name: "hedgie" },
        { type: "broadcast", range: "here" },
        { type: "usergroup", usergroup_id: "S1" },
        { type: "date", timestamp: 1, fallback: "today" },
        { type: "color", value: "#fff" },
        { type: "unknown" }
      )
    );
    expect(blocksToBody(blocks, { plain: false })).toBe("<u>u</u><@U1><#C1><https://x.test/?a=1&amp;b=2|the doc><https://y.test>:hedgie:<!here><!subteam^S1>today#fff");
  });

  it("writes lists, quotes and code blocks, and a Slack message's text escaped but a Hub message's not", () => {
    const blocks = rich(
      section(text("a < b & ", { underline: true }), text("\n")),
      { type: "rich_text_list", style: "bullet", indent: 0, elements: [section(text("x")), section(text("y"))] },
      { type: "rich_text_list", style: "ordered", indent: 1, offset: 2, elements: [section(text("p"))] },
      { type: "rich_text_quote", elements: [text("q1\nq2")] },
      { type: "rich_text_preformatted", elements: [text("<b>\ncode")] }
    );
    expect(blocksToBody(blocks, { plain: false })).toBe("<u>a &lt; b &amp; </u>\n• x\n• y\n  3. p\n&gt; q1\n&gt; q2\n```\n&lt;b&gt;\ncode\n```");
    expect(blocksToBody(blocks, { plain: true })).toBe("<u>a < b & </u>\n• x\n• y\n  3. p\n> q1\n> q2\n```\n<b>\ncode\n```");
  });

  it("finds an underline anywhere, and is the inverse of bodyToBlocks for what a Hub message can carry", () => {
    expect(blocksToBody(rich({ type: "rich_text_list", style: "bullet", indent: 0, elements: [section(text("x", { underline: true }))] }), { plain: true })).toBe("• <u>x</u>");
    const body = "one <u>two</u> *three* <@U1>\n• a <u>b</u>\n> q\n```\ncode\n```";
    expect(blocksToBody(bodyToBlocks(body, { plain: true }), { plain: true })).toBe(body);
  });
});
