import { describe, it, expect } from "vitest";
import { blocksToBody, bodyToBlocks, hasUnderline, isInvalidBlocks, needsBlocks, stripUnderline, type RichTextBlock } from "@/lib/chat/rich-blocks";

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

describe("needsBlocks / isInvalidBlocks", () => {
  it("is true for an underline or a list line (bulleted, numbered, nested), false for everything else, a list inside a code block included", () => {
    for (const body of ["a <u>b</u>", "• a", "1. a", "text\n  ◦ nested", "intro\n2. two"]) expect(needsBlocks(body), body).toBe(true);
    for (const body of ["plain *bold* _italic_ ~s~ `c`", "> quote", "```\n1. a\n• b\n```", "1.5 million", "a <u>unclosed", "tea & biscuits"]) expect(needsBlocks(body), body).toBe(false);
  });

  it("recognises Slack's refusal of blocks, and nothing else", () => {
    expect(isInvalidBlocks({ data: { error: "invalid_blocks" } })).toBe(true);
    for (const other of [{ data: { error: "channel_not_found" } }, new Error("invalid_blocks"), null, undefined, "invalid_blocks"]) expect(isInvalidBlocks(other)).toBe(false);
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

  it("makes numbered and nested lists as Slack's flat lists: one per run of the same kind and depth, with the offset of one that picks up again", () => {
    const body = "1. an <u>underline</u>\n2. <u>continued</u> until now\n  1. no underline\n  2. <u>under returns</u>\n3. what\n  • <u>*about*</u>\n    • _now_";
    const [block] = bodyToBlocks(body, { plain: true });
    expect(block.elements.map((e) => (e.type === "rich_text_list" ? [e.style, e.indent, e.offset ?? 0, e.elements.length] : e.type))).toEqual([
      ["ordered", 0, 0, 2],
      ["ordered", 1, 0, 2],
      ["ordered", 0, 2, 1],
      ["bullet", 1, 0, 1],
      ["bullet", 2, 0, 1],
    ]);
    const last = block.elements[4] as { elements: { elements: unknown[] }[] };
    expect(last.elements[0].elements).toEqual([{ type: "text", text: "now", style: { italic: true } }]);
    const fourth = block.elements[3] as { elements: { elements: unknown[] }[] };
    expect(fourth.elements[0].elements).toEqual([{ type: "text", text: "about", style: { underline: true, bold: true } }]);
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

  it("reads a nested numbered list with underline, bold and italic together (as Slack sends it) into a body that reads back the same", () => {
    const blocks = rich(
      { type: "rich_text_list", style: "ordered", indent: 0, elements: [section(text("an "), text("underline", { underline: true })), section(text("continued", { underline: true }), text(" until now"))] },
      { type: "rich_text_list", style: "ordered", indent: 1, elements: [section(text("no underline")), section(text("under returns", { underline: true })), section(text("no more"))] },
      { type: "rich_text_list", style: "ordered", indent: 0, offset: 2, elements: [section(text("what"))] },
      { type: "rich_text_list", style: "ordered", indent: 1, elements: [section(text("about", { underline: true, bold: true }))] },
      { type: "rich_text_list", style: "ordered", indent: 2, elements: [section(text("now", { underline: true, italic: true }))] }
    );
    const body = blocksToBody(blocks, { plain: false })!;
    expect(body).toBe("1. an <u>underline</u>\n2. <u>continued</u> until now\n  1. no underline\n  2. <u>under returns</u>\n  3. no more\n3. what\n  1. <u>*about*</u>\n    1. <u>_now_</u>");
    // And sending it back keeps the shape (the numbers inside a nested list are Slack's to letter).
    const again = bodyToBlocks(body, { plain: false })[0].elements.map((e) => (e.type === "rich_text_list" ? [e.indent, e.elements.length] : e.type));
    expect(again).toEqual([[0, 2], [1, 3], [0, 1], [1, 1], [2, 1]]);
  });

  it("finds an underline anywhere, and is the inverse of bodyToBlocks for what a Hub message can carry", () => {
    expect(blocksToBody(rich({ type: "rich_text_list", style: "bullet", indent: 0, elements: [section(text("x", { underline: true }))] }), { plain: true })).toBe("• <u>x</u>");
    const body = "one <u>two</u> *three* <@U1>\n• a <u>b</u>\n> q\n```\ncode\n```";
    expect(blocksToBody(bodyToBlocks(body, { plain: true }), { plain: true })).toBe(body);
  });
});
