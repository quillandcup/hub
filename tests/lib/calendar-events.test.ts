import { describe, expect, it } from "vitest";
import {
  calendarCategory,
  calendarEventFields,
  calendarTitle,
  isOverridableField,
  orgDate,
  overridesAfterEdit,
  slugify,
  syncableFields,
} from "@/lib/calendar-events";
import { withoutFollowedEvents, type EventPrickle } from "@/lib/event-prickles";

describe("orgDate", () => {
  it("is the Eastern date, not the UTC one", () => {
    expect(orgDate("2097-03-04T03:30:00Z")).toBe("2097-03-03"); // 22:30 the evening before, Eastern
    expect(orgDate("2097-03-04T05:30:00Z")).toBe("2097-03-04"); // 00:30 Eastern
  });

  it("follows daylight saving: the same UTC hour is a different Eastern day around the change", () => {
    // 2097-03-10 is the second Sunday of March: 04:30Z is 23:30 the day before in EST, 00:30 in EDT.
    expect(orgDate("2097-03-09T04:30:00Z")).toBe("2097-03-08");
    expect(orgDate("2097-03-11T04:30:00Z")).toBe("2097-03-11");
    // First Sunday of November: 04:30Z is 00:30 EDT before the change, 23:30 the day before in EST after it.
    expect(orgDate("2097-11-02T04:30:00Z")).toBe("2097-11-02");
    expect(orgDate("2097-11-04T04:30:00Z")).toBe("2097-11-03");
  });
});

describe("calendarTitle", () => {
  it.each([
    ["Query Letters w/Sam", "Query Letters"],
    ["'Midnight Crew' w/Ada", "Midnight Crew"],
    ["Hedgie Book Fair", "Hedgie Book Fair"],
    ["  Pitch Prickle  ", "Pitch Prickle"],
    ["", "Untitled event"],
    [null, "Untitled event"],
    ["w/Sam", "Untitled event"],
    // The community's calendar titles: the organization's label, the [Category] and the "Prickle:" label come off,
    // and so does the guest after "with".
    [
      "Quill & Cup [Authorpreneurship] Prickle: A Way to Make Money as an Author with Brayden Bonnesen of AuthorTip",
      "A Way to Make Money as an Author",
    ],
    [
      "Quill & Cup [Authorpreneurship] Prickle: Meeting What Readers Want (at Book Events) with Fantasy Author Birgit Schreiber",
      "Meeting What Readers Want (at Book Events)",
    ],
    ["Quill & Cup [Challenge]: Taper Caper Kick-Off!", "Taper Caper Kick-Off!"],
    ["Q&C [Craft] Prickle: Tiny Things w/Ada", "Tiny Things"],
    ["[Craft] Prickle: Outlining", "Outlining"],
    // A name that only starts like the label is a name.
    ["Quill & Cup Challenge", "Quill & Cup Challenge"],
    ["Q&C Birthday Party", "Q&C Birthday Party"],
    ["Q&C DAYDREAM PRICKLE w/Ania", "Q&C DAYDREAM PRICKLE"],
    // Nothing is left of the title: the category stands in.
    ["Quill & Cup [Challenge]", "Challenge"],
    ["Quill & Cup [Challenge]:", "Challenge"],
  ])("%j -> %j", (summary, title) => {
    expect(calendarTitle(summary)).toBe(title);
  });
});

describe("calendarCategory", () => {
  it.each([
    ["Quill & Cup [Authorpreneurship] Prickle: A Way to Make Money with Sam", "Authorpreneurship"],
    ["Quill & Cup [Challenge]: Taper Caper Kick-Off!", "Challenge"],
    ["[Craft] Outlining", "Craft"],
    ["Heads Down Prickle", null],
    ["Quill & Cup Challenge", null],
    ["Prickle [not a category] w/Ada", null],
    [null, null],
  ])("%j -> %j", (summary, category) => {
    expect(calendarCategory(summary)).toBe(category);
  });
});

describe("calendarEventFields", () => {
  const source = {
    summary: "Hedgie Book Fair w/Ada",
    description: "<p>Come <b>browse</b></p>",
    location: "  Zoom room 2  ",
    start_time: "2097-05-02T23:00:00Z",
    end_time: "2097-05-03T01:00:00Z",
  };

  it("takes the title, plain-text description, trimmed location, exact times and Eastern dates", () => {
    expect(calendarEventFields(source)).toEqual({
      title: "Hedgie Book Fair",
      description: "Come browse",
      location: "Zoom room 2",
      starts_at: "2097-05-02",
      ends_at: "2097-05-02", // 01:00Z is 21:00 Eastern the same day
      start_time: source.start_time,
      end_time: source.end_time,
    });
  });

  it("ends an event that finishes exactly at midnight Eastern on the day before", () => {
    const fields = calendarEventFields({ ...source, start_time: "2097-05-03T00:00:00Z", end_time: "2097-05-03T04:00:00Z" });
    expect(fields.starts_at).toBe("2097-05-02");
    expect(fields.ends_at).toBe("2097-05-02"); // ends 00:00 EDT on the 3rd, so the 2nd is its last day
  });

  it("never ends before it starts, even for a very short event", () => {
    const fields = calendarEventFields({ ...source, start_time: "2097-05-03T04:00:00Z", end_time: "2097-05-03T04:00:30Z" });
    expect(fields.ends_at >= fields.starts_at).toBe(true);
  });

  it("leaves an empty description and location null", () => {
    const fields = calendarEventFields({ ...source, description: null, location: "   " });
    expect(fields.description).toBeNull();
    expect(fields.location).toBeNull();
  });
});

describe("syncableFields", () => {
  const fields = calendarEventFields({
    summary: "Open House",
    description: "From the calendar",
    location: "Zoom",
    start_time: "2097-05-02T23:00:00Z",
    end_time: "2097-05-03T01:00:00Z",
  });

  it("writes everything when nothing is overridden", () => {
    expect(syncableFields(fields, [])).toEqual(fields);
  });

  it("always writes dates and times, and leaves overridden text alone", () => {
    const synced = syncableFields(fields, ["title", "location"]);
    expect(synced).toEqual({
      description: "From the calendar",
      starts_at: fields.starts_at,
      ends_at: fields.ends_at,
      start_time: fields.start_time,
      end_time: fields.end_time,
    });
    expect(synced).not.toHaveProperty("title");
    expect(synced).not.toHaveProperty("location");
  });
});

describe("overridesAfterEdit", () => {
  const current = { title: "Open House", description: "From the calendar", location: "Zoom", overridden_fields: ["location"] };

  it("overrides a field given text that differs from what the row holds, keeping those already overridden, sorted", () => {
    expect(overridesAfterEdit(current, { title: "Open House", description: "New text", location: "Zoom" })).toEqual({
      overridden: ["description", "location"],
      follow: [],
    });
    expect(overridesAfterEdit(current, { title: "Fall Open House" })).toEqual({ overridden: ["location", "title"], follow: [] });
  });

  it("changes nothing for a form saved untouched, however many fields it sends", () => {
    expect(overridesAfterEdit(current, { title: "Open House", description: "From the calendar", location: "Zoom" })).toEqual({
      overridden: ["location"],
      follow: [],
    });
  });

  it("follows the calendar again for a field left empty: no override, and the caller takes the calendar's value", () => {
    expect(overridesAfterEdit(current, { location: "" })).toEqual({ overridden: [], follow: ["location"] });
    expect(overridesAfterEdit(current, { description: null })).toEqual({ overridden: ["location"], follow: ["description"] });
    expect(overridesAfterEdit(current, { title: "   ", description: "" })).toEqual({ overridden: ["location"], follow: ["title", "description"] });
  });

  it("leaves a field the edit doesn't name alone", () => {
    expect(overridesAfterEdit(current, {})).toEqual({ overridden: ["location"], follow: [] });
  });
});

describe("isOverridableField and slugify", () => {
  it("knows which fields an admin can override", () => {
    expect(isOverridableField("title")).toBe(true);
    expect(isOverridableField("starts_at")).toBe(false);
    expect(isOverridableField(3)).toBe(false);
  });

  it("makes an address from a title", () => {
    expect(slugify("  Hedgie Book Fair & Fun! ")).toBe("hedgie-book-fair-fun");
  });
});

describe("withoutFollowedEvents", () => {
  const prickle = (id: string, calendarEventId: string | null): EventPrickle => ({
    id,
    title: null,
    typeName: "Pitch Prickle",
    hostName: null,
    calendarEventId,
    startTime: "2097-03-03T15:00:00Z",
    endTime: "2097-03-03T16:00:00Z",
  });

  it("drops the prickles an event already follows and keeps the rest, including ones with no calendar event", () => {
    const list = [prickle("a", "cal-1"), prickle("b", "cal-2"), prickle("c", null)];
    expect(withoutFollowedEvents(list, ["cal-2", "cal-9"]).map((p) => p.id)).toEqual(["a", "c"]);
    expect(withoutFollowedEvents(list, []).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});
