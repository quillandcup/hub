import { describe, it, expect } from "vitest";
import { docIsEmojiOnly, docToMrkdwn, mrkdwnToDoc, type EmojiLookup, type RichNode } from "@/lib/chat/rich-text";

const t = (text: string, ...marks: (string | { type: string; attrs: Record<string, unknown> })[]): RichNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const p = (...content: RichNode[]): RichNode => ({ type: "paragraph", ...(content.length ? { content } : {}) });
const doc = (...content: RichNode[]): RichNode => ({ type: "doc", content });
const link = (href: string) => ({ type: "link", attrs: { href } });

const lookup: EmojiLookup = (name) =>
  name === "hedgie" ? { url: "https://emoji.example.test/hedgie.png" } : name === "hog" ? { text: "\u{1F994}" } : null;

describe("docToMrkdwn", () => {
  it("writes each mark as Slack's marker, nested the same way every time", () => {
    expect(docToMrkdwn(doc(p(t("a "), t("bold", "bold"), t(" "), t("both", "bold", "italic"), t(" "), t("gone", "strike"), t(" "), t("x < y", "code"))))).toBe(
      "a *bold* *_both_* ~gone~ `x < y`"
    );
  });

  it("writes an underline as <u>…</u>, outermost, with its spaces inside it", () => {
    expect(docToMrkdwn(doc(p(t("a "), t("under ", "underline"), t("both", "underline", "bold"), t(" b"))))).toBe("a <u>under *both*</u> b");
    expect(docToMrkdwn(doc(p(t("x", "underline", "italic"))))).toBe("<u>_x_</u>");
  });

  it("keeps the markers against the words, with the spaces outside", () => {
    expect(docToMrkdwn(doc(p(t("a"), t(" spaced ", "bold"), t("b"))))).toBe("a *spaced* b");
    expect(docToMrkdwn(doc(p(t("  ", "bold"))))).toBe("  ");
  });

  it("writes a link as <address|label>, or <address> when the label is the address, under any emphasis", () => {
    expect(docToMrkdwn(doc(p(t("the docs", link("https://x.test/a")))))).toBe("<https://x.test/a|the docs>");
    expect(docToMrkdwn(doc(p(t("https://x.test", link("https://x.test")))))).toBe("<https://x.test>");
    expect(docToMrkdwn(doc(p(t("a|b>c", "bold", link("https://x.test")))))).toBe("*<https://x.test|abc>*");
    expect(docToMrkdwn(doc(p(t("one", link("https://x.test")), t("two", link("https://x.test")))))).toBe("<https://x.test|onetwo>");
    expect(docToMrkdwn(doc(p(t("no address", { type: "link", attrs: { href: "" } }))))).toBe("no address");
  });

  it("writes emoji nodes as :name:, lines, quotes, lists and code blocks as Slack's text", () => {
    expect(docToMrkdwn(doc(p(t("hi "), { type: "emoji", attrs: { name: "hedgie" } }), p(), p(t("a"), { type: "hardBreak" }, t("b"))))).toBe("hi :hedgie:\n\na\nb");
    expect(docToMrkdwn(doc({ type: "blockquote", content: [p(t("one")), p(t("two"))] }))).toBe("> one\n> two");
    expect(
      docToMrkdwn(
        doc(
          { type: "bulletList", content: [{ type: "listItem", content: [p(t("x"))] }, { type: "listItem", content: [p(t("y"), { type: "hardBreak" }, t("z"))] }] },
          { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("c"))] }, { type: "listItem", content: [p(t("d"))] }] }
        )
      )
    ).toBe("• x\n• y\n  z\n3. c\n4. d");
    expect(docToMrkdwn(doc({ type: "codeBlock", content: [t("a\nb")] }))).toBe("```\na\nb\n```");
    expect(docToMrkdwn(doc({ type: "codeBlock" }))).toBe("```\n\n```");
    expect(docToMrkdwn(doc({ type: "horizontalRule" }, p(t("kept"))))).toBe("kept");
    expect(docToMrkdwn({ type: "doc" })).toBe("");
  });
});

describe("mrkdwnToDoc", () => {
  it("reads inline markers, links and known emoji, and leaves everything else as typed", () => {
    expect(mrkdwnToDoc("a *b _c_* ~d~ `e` <https://x.test|f> <https://y.test> :hedgie: :hog: :nope: 5 * 3 * 2 <b>", lookup).content).toEqual([
      p(
        t("a "),
        t("b ", "bold"),
        t("c", "italic", "bold"),
        t(" "),
        t("d", "strike"),
        t(" "),
        t("e", "code"),
        t(" "),
        t("f", link("https://x.test")),
        t(" "),
        t("https://y.test", link("https://y.test")),
        t(" "),
        { type: "emoji", attrs: { name: "hedgie", url: "https://emoji.example.test/hedgie.png", text: null } },
        t(" "),
        { type: "emoji", attrs: { name: "hog", url: null, text: "\u{1F994}" } },
        t(" :nope: 5 * 3 * 2 <b>")
      ),
    ]);
  });

  it("reads <u>…</u> as an underline mark, around other marks and inside them", () => {
    expect(mrkdwnToDoc("a <u>b *c*</u> *<u>d</u>* <u>unclosed").content).toEqual([
      p(t("a "), t("b ", "underline"), t("c", "bold", "underline"), t(" "), t("d", "underline", "bold"), t(" <u>unclosed")),
    ]);
  });

  it("keeps code free of other marks, and reads emphasis inside emphasis", () => {
    expect(mrkdwnToDoc("*`x`*").content).toEqual([p(t("x", "code"))]);
  });

  it("reads quotes, bullet and numbered lines and fences into blocks", () => {
    const parsed = mrkdwnToDoc("intro\n> q1\n> q2\n• a\n◦ b\n1. one\n2. two\n```\nlet x = 1\n\n```\nafter").content!;
    expect(parsed.map((b) => b.type)).toEqual(["paragraph", "blockquote", "bulletList", "orderedList", "codeBlock", "paragraph"]);
    expect(parsed[1].content).toEqual([p(t("q1")), p(t("q2"))]);
    expect(parsed[2].content).toHaveLength(2);
    expect(parsed[4]).toEqual({ type: "codeBlock", content: [t("let x = 1\n")] });
  });

  it("reads one-line and empty fences, and treats an unclosed fence as text", () => {
    expect(mrkdwnToDoc("```code```").content).toEqual([{ type: "codeBlock", content: [t("code")] }]);
    expect(mrkdwnToDoc("```\n```").content).toEqual([{ type: "codeBlock" }]);
    expect(mrkdwnToDoc("```oops").content).toEqual([p(t("```oops"))]);
  });

  it("nests list items by how far they are indented (two spaces or Slack's four), mixing bullets and numbers, and starts a number list where it says", () => {
    const parsed = mrkdwnToDoc("1. a\n    • b\n    • c\n        1. d\n2. e\n• f\n3. g").content!;
    expect(parsed.map((n) => n.type)).toEqual(["orderedList", "bulletList", "orderedList"]);
    const first = parsed[0].content!;
    expect(first).toHaveLength(2);
    expect(first[0].content!.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    const inner = first[0].content![1].content!;
    expect(inner).toHaveLength(2);
    expect(inner[1].content!.map((n) => n.type)).toEqual(["paragraph", "orderedList"]);
    expect(parsed[2].attrs).toEqual({ start: 3 });
  });

  it("reads Slack's own nested numbered list (a. and i. at their levels) into nested ordered lists, and caps the depth at five levels", () => {
    const [list] = mrkdwnToDoc("1. a\n    a. b\n        i. c\n            1. d\n                a. e").content!;
    const depth = (n: RichNode): number => (n.type === "orderedList" ? 1 : 0) + Math.max(0, ...(n.content ?? []).map(depth));
    expect(list.type).toBe("orderedList");
    expect(depth(list)).toBe(5);
    const bullets = ["• 0", "  • 1", "    • 2", "      • 3", "        • 4", "          • 5", "            • 6"].join("\n");
    const [deep] = mrkdwnToDoc(bullets).content!;
    const bulletDepth = (n: RichNode): number => (n.type === "bulletList" ? 1 : 0) + Math.max(0, ...(n.content ?? []).map(bulletDepth));
    expect(bulletDepth(deep)).toBe(5);
    // The two beyond the fifth sit beside it, not under it.
    expect(docToMrkdwn({ type: "doc", content: [deep] })).toBe(["• 0", "  • 1", "    • 2", "      • 3", "        • 4", "        • 5", "        • 6"].join("\n"));
  });

  it("makes an empty document one empty paragraph, and a blank line an empty paragraph", () => {
    expect(mrkdwnToDoc("").content).toEqual([p()]);
    expect(mrkdwnToDoc("a\n\nb").content).toEqual([p(t("a")), p(), p(t("b"))]);
  });
});

describe("round trip", () => {
  it.each([
    "plain words",
    "a *bold* _it_ ~gone~ `code` here",
    "*_both_* and <https://x.test|a link> and <https://x.test>",
    "plain <u>under line</u> and <u>_both_</u> and <u>*<https://x.test|link>*</u>",
    "> quoted line\n> another",
    "• one\n• two\n1. first\n2. second",
    "1. an <u>underline</u>\n2. <u>continued</u> until now\n  • no underline\n  • <u>under returns</u>\n    1. deeper *bold*\n3. what\n• after",
    "```\nlet a = 1\nlet b = 2\n```",
    "line one\n\nline three :hedgie:",
    "a < b & c > d — nothing here is markup",
  ])("keeps %j as it was", (source) => {
    expect(docToMrkdwn(mrkdwnToDoc(source, lookup))).toBe(source);
  });
});

describe("docIsEmojiOnly", () => {
  it("is true for one line of emoji characters and emoji images, false for typed :name: letters, text or several blocks", () => {
    expect(docIsEmojiOnly(doc(p(t("\u{1F64F}"), t(" "), { type: "emoji", attrs: { name: "hedgie" } })))).toBe(true);
    expect(docIsEmojiOnly(doc(p(t(":hedgie:"))))).toBe(false);
    expect(docIsEmojiOnly(doc(p(t("\u{1F64F} hi"))))).toBe(false);
    expect(docIsEmojiOnly(doc(p(t("\u{1F64F}")), p(t("\u{1F64F}"))))).toBe(false);
    expect(docIsEmojiOnly(doc(p()))).toBe(false);
    expect(docIsEmojiOnly(doc({ type: "blockquote", content: [p(t("\u{1F64F}"))] }))).toBe(false);
    // A trailing line break is only whitespace.
    expect(docIsEmojiOnly(doc(p(t("\u{1F64F}"), { type: "hardBreak" })))).toBe(true);
  });
});
