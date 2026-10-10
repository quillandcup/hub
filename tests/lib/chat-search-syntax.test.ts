import { describe, it, expect } from "vitest";
import { parseSearch } from "@/lib/chat/search-syntax";

describe("parseSearch (Slack search syntax)", () => {
  it("ANDs plain words", () => {
    expect(parseSearch("pineapple pizza").tsquery).toBe("('pineapple') & ('pizza')");
  });

  it("keeps quoted phrases together and supports exclusion and prefixes", () => {
    expect(parseSearch('"pizza night" -onions pine*').tsquery).toBe("('pizza' <-> 'night') & !('onions') & ('pine':*)");
    expect(parseSearch('-"bad idea"').tsquery).toBe("!('bad' <-> 'idea')");
  });

  it("reads modifiers and leaves the words", () => {
    const p = parseSearch("in:#general from:@fern has:link has:file has:reaction is:thread dinner");
    expect(p).toMatchObject({ inChannel: "general", from: "fern", hasLink: true, hasFiles: true, hasReaction: true, isThread: true });
    expect(p.tsquery).toBe("('dinner')");
    expect(p.text).toBe("dinner");
  });

  it("treats after: as exclusive and before: as the start of the day", () => {
    const p = parseSearch("after:2026-10-01 before:2026-10-31");
    expect(p.after).toBe("2026-10-02T00:00:00.000Z");
    expect(p.before).toBe("2026-10-31T00:00:00.000Z");
  });

  it("on: and during: cover the whole day, month or year", () => {
    expect(parseSearch("on:2026-10-09")).toMatchObject({ after: "2026-10-09T00:00:00.000Z", before: "2026-10-10T00:00:00.000Z" });
    expect(parseSearch("during:2026-12")).toMatchObject({ after: "2026-12-01T00:00:00.000Z", before: "2027-01-01T00:00:00.000Z" });
    expect(parseSearch("during:2026")).toMatchObject({ after: "2026-01-01T00:00:00.000Z", before: "2027-01-01T00:00:00.000Z" });
  });

  it("searches an unrecognized modifier or bad date as words, and drops tsquery syntax characters", () => {
    expect(parseSearch("after:nonsense").tsquery).toBe("('after' <-> 'nonsense')");
    expect(parseSearch("a'b & (c) | !d:*").tsquery).toBe("('a' <-> 'b') & ('c') & ('d':*)");
    expect(parseSearch("on:2026-02-31").after).toBeUndefined();
  });

  it("has no query for filters alone", () => {
    expect(parseSearch("from:me").tsquery).toBe("");
  });
});
