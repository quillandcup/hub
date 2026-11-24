/** The one-line editor's document and the stored token text, both ways: what is saved is the plain token string, unchanged. */
import { describe, expect, it } from "vitest";
import { oneLine, toDoc, toText } from "@/components/landing/placeholder-doc";

describe("toDoc and toText", () => {
  it("makes a known token an atom and writes it back as the same token", () => {
    const doc = toDoc("© {year:2019} Quill & Cup");
    expect(doc.content?.[0].content).toEqual([
      { type: "text", text: "© " },
      { type: "placeholder", attrs: { name: "year", param: "2019" } },
      { type: "text", text: " Quill & Cup" },
    ]);
    expect(toText(doc)).toBe("© {year:2019} Quill & Cup");
  });

  it("round-trips text without a line break exactly, unknown braces included", () => {
    for (const text of ["", "plain", "{year}", "{year}{year:2020}", "© {year} {member} {year:19} {", "  spaced  {year}  "]) {
      expect(toText(toDoc(text))).toBe(text);
    }
  });

  it("is one empty paragraph for no text", () => {
    expect(toDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("treats a bare placeholder (no start year) as having no parameter", () => {
    expect(toDoc("{year}").content?.[0].content).toEqual([{ type: "placeholder", attrs: { name: "year", param: null } }]);
    expect(toText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "placeholder", attrs: { name: "year", param: null } }] }] })).toBe("{year}");
  });
});

describe("oneLine", () => {
  it("turns line breaks and the spaces around them into one space", () => {
    expect(oneLine("one\ntwo\r\nthree \n  four")).toBe("one two three four");
    expect(oneLine("no break")).toBe("no break");
  });
});
