import { describe, it, expect } from "vitest";
import { smartReplacement } from "@/lib/chat/smart-typography";

/** What typing `typed` after `before` gives, as the text. */
const typeAfter = (before: string, typed: string): string => {
  const r = smartReplacement(before, typed);
  return r ? before.slice(0, before.length - r.remove) + r.insert : before + typed;
};

describe("smartReplacement", () => {
  it("makes double quotes curly: opening at the start, after a space, an opening bracket or a dash, closing anywhere else", () => {
    expect(typeAfter("", '"')).toBe("“");
    expect(typeAfter("He said ", '"')).toBe("He said “");
    expect(typeAfter("(", '"')).toBe("(“");
    expect(typeAfter("so—", '"')).toBe("so—“");
    expect(typeAfter("He said “hi", '"')).toBe("He said “hi”");
    expect(typeAfter("He said “", '"')).toBe("He said ““");
    expect(typeAfter("5", '"')).toBe("5”");
    expect(typeAfter("done.", '"')).toBe("done.”");
  });

  it("makes single quotes curly too, so an apostrophe is the closing one", () => {
    expect(typeAfter("it", "'")).toBe("it’");
    expect(typeAfter("", "'")).toBe("‘");
    expect(typeAfter("she said ", "'")).toBe("she said ‘");
    expect(typeAfter("rock ", "'")).toBe("rock ‘");
  });

  it("turns -- into an em-dash, ... into an ellipsis, -> and <- into arrows", () => {
    expect(typeAfter("wait -", "-")).toBe("wait —");
    expect(typeAfter("and so.", ".")).toBe("and so..");
    expect(typeAfter("and so..", ".")).toBe("and so…");
    expect(typeAfter("a -", ">")).toBe("a →");
    expect(typeAfter("a <", "-")).toBe("a ←");
  });

  it("leaves a single dash, dot, greater-than or less-than as typed, and every other character", () => {
    for (const [before, typed] of [["a", "-"], ["a", "."], ["a", ">"], ["a", "<"], ["a-", "x"], ["a", "x"], ["a ", " "]] as const) {
      expect(smartReplacement(before, typed), `${before}${typed}`).toBeNull();
    }
  });

  it("leaves an address alone: its dashes, dots and quotes are its own", () => {
    for (const [before, typed] of [["see https://x.test/a-", "-"], ["see https://x.test/a..", "."], ["www.x-", "-"], ["mailto:a@x.test/a-", "-"], ["see http://x.test/?q=", '"']] as const) {
      expect(smartReplacement(before, typed), `${before}${typed}`).toBeNull();
    }
    // But the next word is not part of it.
    expect(typeAfter("see https://x.test and -", "-")).toBe("see https://x.test and —");
  });
});
