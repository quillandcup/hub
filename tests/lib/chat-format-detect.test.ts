import { describe, expect, it } from "vitest";
import { formatsFromSteps, formatsInSlice } from "@/lib/chat/format-text";

describe("formatsInSlice (pasted content)", () => {
  it("finds nothing in plain pasted text", () => {
    expect(formatsInSlice({ content: [{ type: "paragraph", content: [{ type: "text", text: "just words" }] }] })).toEqual([]);
  });

  it("finds marks and blocks that came along, once each", () => {
    const slice = {
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "bold" }] }, { type: "text", text: "b", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://x" } }] }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "q", marks: [{ type: "underline" }] }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }, { type: "orderedList", content: [] }] }] },
        { type: "codeBlock", content: [{ type: "text", text: "x" }] },
      ],
    };
    expect(formatsInSlice(slice).sort()).toEqual(["bold", "bullets", "codeblock", "link", "numbers", "quote", "underline"]);
  });

  it("ignores things it doesn't know and malformed input", () => {
    expect(formatsInSlice(null)).toEqual([]);
    expect(formatsInSlice({ content: [{ type: "mystery", marks: [{ type: "sparkle" }, null] }, "text"] })).toEqual([]);
  });
});

describe("formatsFromSteps (typed markers)", () => {
  it("reads a mark added, as the editor's mark input rules do", () => {
    expect(formatsFromSteps([{ stepType: "replace", from: 1, to: 6, slice: { content: [{ type: "text", text: "word" }] } }, { stepType: "addMark", from: 1, to: 5, mark: { type: "bold" } }])).toEqual(["bold"]);
    expect(formatsFromSteps([{ stepType: "addMark", mark: { type: "strike" } }])).toEqual(["strike"]);
  });

  it("reads a block wrapped around the line, as `> `, `- `, `1. ` and a fence do", () => {
    expect(formatsFromSteps([{ stepType: "replaceAround", slice: { content: [{ type: "blockquote" }] } }])).toEqual(["quote"]);
    expect(formatsFromSteps([{ stepType: "replaceAround", slice: { content: [{ type: "bulletList" }] } }])).toEqual(["bullets"]);
    expect(formatsFromSteps([{ stepType: "replaceAround", slice: { content: [{ type: "orderedList" }] } }])).toEqual(["numbers"]);
    expect(formatsFromSteps([{ stepType: "replaceAround", slice: { content: [{ type: "codeBlock" }] } }])).toEqual(["codeblock"]);
  });

  it("finds nothing in steps that only change text, and skips what it can't read", () => {
    expect(formatsFromSteps([{ stepType: "replace", slice: { content: [{ type: "text", text: "hi" }] } }, { stepType: "addMark", mark: { type: "mystery" } }, null, "x", { stepType: "addMark" }])).toEqual([]);
  });
});
