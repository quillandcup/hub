import { describe, expect, it } from "vitest";
import {
  calendarCategory,
  calendarEventFields,
  calendarTitle,
  eventUpdateFor,
  prickleEventFields,
  isOverridableField,
  orgDate,
  overridesAfterEdit,
  slugify,
  syncableFields,
} from "@/lib/calendar-events";
import { withoutFollowedEvents, type EventPrickle } from "@/lib/event-prickles";
import type { PrickleDetail } from "@/lib/data/prickles";

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
      description: "Come **browse**",
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

describe("an event that stands for a prickle", () => {
  const prickle = (over: Partial<PrickleDetail> = {}): PrickleDetail =>
    ({
      id: "prkl_AAAAAAAAAAA1",
      typeId: "prty_AAAAAAAAAAA1",
      hostId: "mbr_AAAAAAAAAAA1",
      title: null,
      description: null,
      guestSpeaker: null,
      startTime: "2097-05-02T23:00:00Z",
      endTime: "2097-05-03T00:00:00Z",
      source: "calendar",
      calendarEventId: "00000000-0000-4000-8000-00000000000a",
      host: { id: "mbr_AAAAAAAAAAA1", name: "Jennifer Parker", displayName: "Jenny" },
      type: { id: "prty_AAAAAAAAAAA1", name: "Free Writing Hour" } as PrickleDetail["type"],
      ...over,
    }) as PrickleDetail;

  const source = {
    summary: "Free Writing Hour w/Jennifer Parker",
    description: "<p>From the calendar</p>",
    location: "Zoom",
    start_time: "2097-05-02T23:00:00Z",
    end_time: "2097-05-03T00:00:00Z",
  };

  describe("prickleEventFields", () => {
    it("takes the prickle's own title, else its type's name; its description without the #event tag; its speaker; and its host's display name", () => {
      expect(prickleEventFields(prickle({ title: "  Tiny Things  ", description: "Come #event along", guestSpeaker: " Ada Example " }))).toEqual({
        title: "Tiny Things",
        description: "Come along",
        speakers: "Ada Example",
        host_name: "Jenny",
      });
      expect(prickleEventFields(prickle())).toEqual({ title: "Free Writing Hour", description: null, speakers: null, host_name: "Jenny" });
    });

    it("has no host name for a prickle with no host, and no title when it has neither a title nor a type", () => {
      expect(prickleEventFields(prickle({ host: null, hostId: null })).host_name).toBeNull();
      expect(prickleEventFields(prickle({ type: null, typeId: null })).title).toBeNull();
    });
  });

  describe("eventUpdateFor", () => {
    it("is the calendar's update when there is no prickle", () => {
      expect(eventUpdateFor(source, ["location"])).toEqual(syncableFields(calendarEventFields(source), ["location"]));
    });

    it("takes title, description, speaker and host from the prickle, ignoring an override of the title or description on the event", () => {
      const update = eventUpdateFor(source, ["title", "description", "location"], prickle({ title: "Tiny Things", description: "Edited on the prickle", guestSpeaker: "Ada Example" }));

      expect(update).toMatchObject({
        title: "Tiny Things",
        description: "Edited on the prickle",
        speakers: "Ada Example",
        host_name: "Jenny",
        starts_at: "2097-05-02",
        start_time: source.start_time,
      });
      expect(update).not.toHaveProperty("location"); // overridden on the event: the sync leaves it
    });

    it("falls back to the calendar's title when the prickle has none to give, and clears a description the prickle no longer has", () => {
      const update = eventUpdateFor(source, [], prickle({ type: null, typeId: null }));
      expect(update).toMatchObject({ title: "Free Writing Hour", description: null, location: "Zoom" });
    });
  });
});

