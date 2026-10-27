import { describe, expect, it } from "vitest";
import { calendarEventFields, descriptionWithoutEventTag, hasEventTag } from "@/lib/calendar-events";

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

describe("calendarEventFields", () => {
  it("leaves the #event tag out of the event's description", () => {
    const fields = calendarEventFields({
      summary: "Book Fair",
      description: "<p>Browse our books</p><p>#event</p>",
      location: null,
      start_time: "2097-05-02T23:00:00Z",
      end_time: "2097-05-03T01:00:00Z",
    });
    expect(fields.description).toBe("Browse our books");
  });
});
