import { describe, expect, it } from "vitest";
import { descriptionWithoutEventTag, hasEventTag, stripEventTag } from "@/lib/calendar-events";

describe("hasEventTag", () => {
  it.each([
    ["#event", true],
    ["#Event", true],
    ["Join us! #event", true],
    ["#event\nMore text", true],
    ["<p>Join us</p><p>#event</p>", true],
    ["Details (#event)", true],
    ["a #event, b", true],
    ["#events", false],
    ["#eventful", false],
    ["no tag here", false],
    ["email me@event.com", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("%j -> %j", (description, expected) => {
    expect(hasEventTag(description)).toBe(expected);
  });

  it("gives the same answer when asked again (the pattern keeps no state between calls)", () => {
    expect(hasEventTag("#event")).toBe(true);
    expect(hasEventTag("#event")).toBe(true);
    expect(hasEventTag("#event")).toBe(true);
  });
});

describe("descriptionWithoutEventTag", () => {
  it.each([
    ["Join us! #event", "Join us!"],
    ["#event\nBring a friend", "Bring a friend"],
    ["<p>Come say hi</p><p>#event</p>", "Come say hi"],
    ["A #event B", "A B"],
    ["#event", null],
    ["  #Event  ", null],
    ["Keep #events and #eventful", "Keep #events and #eventful"],
    [null, null],
    ["", null],
  ])("%j -> %j", (description, expected) => {
    expect(descriptionWithoutEventTag(description)).toBe(expected);
  });
});

describe("stripEventTag", () => {
  it("takes the tag out of markdown without escaping it a second time", () => {
    const markdown = "Working *with* the month\n\n\\------\n\n[https://example.com/j/1](https://example.com/j/1) #event";
    expect(stripEventTag(markdown)).toBe("Working *with* the month\n\n\\------\n\n[https://example.com/j/1](https://example.com/j/1)");
  });

  it("is null for nothing", () => {
    expect(stripEventTag(null)).toBeNull();
    expect(stripEventTag("  #event ")).toBeNull();
  });
});
