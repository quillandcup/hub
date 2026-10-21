import { describe, it, expect } from "vitest";
import { searchShape } from "@/lib/analytics/search";
import { isEventName, validateProperties } from "@/lib/analytics/events";

describe("searchShape", () => {
  it("counts plain words and names no operators for a plain query", () => {
    expect(searchShape("fern lunch")).toEqual({ kind: "all", operators: "", words: 2, wantsChat: false });
  });

  it("reports operators by name only, sorted, never their values", () => {
    const shape = searchShape("from:fern@example.test after:2026-01-01 in:chat lunch");
    expect(shape).toEqual({ kind: "chat", operators: "after,from,in", words: 1, wantsChat: true });
    expect(JSON.stringify(shape)).not.toMatch(/fern|example|2026|lunch/);
  });

  it("treats kind: and type: as in:", () => {
    expect(searchShape("kind:members x").operators).toBe("in");
    expect(searchShape("type:books x").operators).toBe("in");
  });

  it("counts a quoted phrase and an excluded word as words, and a negated operator as an operator", () => {
    expect(searchShape('"secret plans" -spam').words).toBe(2);
    expect(searchShape("-from:fern lunch")).toMatchObject({ operators: "from", words: 1 });
  });

  it("says unknown for an in: that names no kind, and all when there is no in:", () => {
    expect(searchShape("in:nonsense x").kind).toBe("unknown");
    expect(searchShape("x").kind).toBe("all");
  });

  it("knows chat-only operators ask for chat to be searched", () => {
    for (const q of ["has:link x", "is:thread x", "channel:general x", "has:file"]) expect(searchShape(q).wantsChat).toBe(true);
    expect(searchShape("from:fern x").wantsChat).toBe(false);
  });

  it("does not mistake an unknown word:thing for an operator", () => {
    expect(searchShape("note:hello")).toMatchObject({ operators: "", words: 1 });
  });

  it("caps the word count and is safe on empty input", () => {
    expect(searchShape(Array(200).fill("w").join(" ")).words).toBe(50);
    expect(searchShape("")).toEqual({ kind: "all", operators: "", words: 0, wantsChat: false });
  });

  it("always fits the search_ran event it feeds", () => {
    const shape = searchShape("in:chat from:a after:b before:c during:d on:e has:f is:g channel:h email:i status:j x");
    expect(isEventName("search_ran")).toBe(true);
    expect(
      validateProperties("search_ran", {
        surface: "palette",
        kind: shape.kind,
        operators: shape.operators,
        words: shape.words,
        results: 3,
        chat_results: 1,
        chat_searched: shape.wantsChat,
      })
    ).toMatchObject({ ok: true });
  });
});
