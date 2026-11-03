import { describe, it, expect } from "vitest";
import { applyFormat, shortcutFormat } from "@/lib/chat/format-text";

const sel = (value: string, from: number, to: number, kind: Parameters<typeof applyFormat>[3]) => {
  const e = applyFormat(value, from, to, kind);
  return [e.value, e.value.slice(e.start, e.end)];
};

describe("applyFormat: inline", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(sel("say hello now", 4, 9, "bold")).toEqual(["say *hello* now", "hello"]);
    expect(sel("a b", 0, 1, "italic")[0]).toBe("_a_ b");
    expect(sel("a b", 2, 3, "strike")[0]).toBe("a ~b~");
    expect(sel("a b", 0, 1, "code")[0]).toBe("`a` b");
  });

  it("puts the markers inside padding spaces, as Slack needs", () => {
    expect(sel("a  hello  b", 2, 9, "bold")).toEqual(["a  *hello*  b", "hello"]);
  });

  it("opens an empty pair around the caret", () => {
    expect(applyFormat("hi ", 3, 3, "bold")).toEqual({ value: "hi **", start: 4, end: 4 });
  });

  it("takes the markers off when they are inside or just outside the selection, and the order of the ends doesn't matter", () => {
    expect(sel("say *hello* now", 4, 11, "bold")).toEqual(["say hello now", "hello"]);
    expect(sel("say *hello* now", 5, 10, "bold")).toEqual(["say hello now", "hello"]);
    expect(sel("say hello now", 9, 4, "bold")[0]).toBe("say *hello* now");
  });
});

describe("applyFormat: code block", () => {
  it("fences the selection and unfences it again", () => {
    const fenced = applyFormat("a\nb", 0, 3, "codeblock");
    expect(fenced.value).toBe("```\na\nb\n```");
    expect(applyFormat(fenced.value, fenced.start, fenced.end, "codeblock").value).toBe("a\nb");
  });
});

describe("applyFormat: lines", () => {
  it("prefixes every line the selection touches, numbering a list", () => {
    expect(sel("one\ntwo\nthree", 2, 6, "bullets")).toEqual(["• one\n• two\nthree", "• one\n• two"]);
    expect(applyFormat("one\ntwo\nthree", 0, 13, "numbers").value).toBe("1. one\n2. two\n3. three");
    expect(applyFormat("one\ntwo", 0, 7, "quote").value).toBe("> one\n> two");
  });

  it("takes the prefix off when every line has it, and stacks a different kind on top", () => {
    expect(applyFormat("• one\n• two", 0, 11, "bullets").value).toBe("one\ntwo");
    expect(applyFormat("1. one\n2. two", 0, 13, "numbers").value).toBe("one\ntwo");
    expect(applyFormat("• one", 0, 5, "numbers").value).toBe("1. • one");
  });

  it("keeps blank lines blank, prefixes an empty box, and keeps a caret in place", () => {
    expect(applyFormat("a\n\nb", 0, 4, "bullets").value).toBe("• a\n\n• b");
    expect(applyFormat("", 0, 0, "bullets")).toEqual({ value: "• ", start: 2, end: 2 });
    expect(applyFormat("one", 2, 2, "quote")).toEqual({ value: "> one", start: 4, end: 4 });
  });
});

describe("shortcutFormat", () => {
  const key = (k: string, extra: object = {}) => ({ key: k, shiftKey: false, altKey: false, metaKey: true, ctrlKey: false, ...extra });
  it("maps Cmd or Ctrl with B, I and Shift+X, and nothing else", () => {
    expect(shortcutFormat(key("b"))).toBe("bold");
    expect(shortcutFormat(key("I", { metaKey: false, ctrlKey: true }))).toBe("italic");
    expect(shortcutFormat(key("x", { shiftKey: true }))).toBe("strike");
    expect(shortcutFormat(key("x"))).toBeNull();
    expect(shortcutFormat(key("b", { metaKey: false }))).toBeNull();
    expect(shortcutFormat(key("b", { altKey: true }))).toBeNull();
    expect(shortcutFormat(key("b", { shiftKey: true }))).toBeNull();
  });
});
