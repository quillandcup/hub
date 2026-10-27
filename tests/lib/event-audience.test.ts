import { describe, expect, it } from "vitest";
import { audienceSummary, parseEventAudience } from "@/lib/event-audience";

describe("parseEventAudience", () => {
  it("returns only the fields the body names", () => {
    expect(parseEventAudience({ title: "Retreat" })).toEqual({ ok: true, fields: {} });
    expect(parseEventAudience({ announced_publicly: true, guests_allowed: true, capacity: 12, registration: "signup", selection: "selected" })).toEqual({
      ok: true,
      fields: { announced_publicly: true, guests_allowed: true, capacity: 12, registration: "signup", selection: "selected" },
    });
  });

  it("clears the limit with null and trims or empties the speakers", () => {
    expect(parseEventAudience({ capacity: null, speakers: "  Ada Example  " })).toEqual({
      ok: true,
      fields: { capacity: null, speakers: "Ada Example" },
    });
    expect(parseEventAudience({ speakers: "   " })).toEqual({ ok: true, fields: { speakers: null } });
    expect(parseEventAudience({ speakers: null })).toEqual({ ok: true, fields: { speakers: null } });
  });

  it.each([
    [{ guests_allowed: "yes" }, "guests_allowed"],
    [{ announced_publicly: 1 }, "announced_publicly"],
    [{ registration: "walk-in" }, "registration"],
    [{ selection: "lottery" }, "selection"],
    [{ capacity: 0 }, "capacity"],
    [{ capacity: -3 }, "capacity"],
    [{ capacity: 2.5 }, "capacity"],
    [{ capacity: "7" }, "capacity"],
    [{ speakers: 42 }, "speakers"],
  ])("rejects %j", (body, field) => {
    const result = parseEventAudience(body);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(field);
  });
});

describe("parseEventAudience: guests need an event announced publicly", () => {
  it("refuses guests without public, and public turned off while guests stay", () => {
    expect(parseEventAudience({ guests_allowed: true })).toEqual({ ok: false, error: "Guests can only be allowed at something announced publicly" });
    expect(parseEventAudience({ announced_publicly: false }, { announced_publicly: true, guests_allowed: true })).toMatchObject({ ok: false });
  });

  it("judges what an update names against what the event has now", () => {
    expect(parseEventAudience({ guests_allowed: true }, { announced_publicly: true, guests_allowed: false })).toEqual({ ok: true, fields: { guests_allowed: true } });
    expect(parseEventAudience({ announced_publicly: false, guests_allowed: false }, { announced_publicly: true, guests_allowed: true })).toEqual({
      ok: true,
      fields: { announced_publicly: false, guests_allowed: false },
    });
  });
});

describe("audienceSummary", () => {
  const base = { guests_allowed: false, registration: "none", capacity: null, selection: "first_come" };

  it("is empty for a members-only event with no sign-up and no limit", () => {
    expect(audienceSummary(base)).toEqual([]);
  });

  it("describes sign-up, a limit and how places go", () => {
    expect(audienceSummary({ ...base, registration: "signup", capacity: 1, selection: "first_come" })).toEqual([
      "Sign-up required",
      "1 place",
      "First come, first served",
    ]);
  });

  it("leaves out how places go when nobody registers, or the mode is unknown", () => {
    expect(audienceSummary({ ...base, capacity: 20 })).toEqual(["20 places"]);
    expect(audienceSummary({ ...base, registration: "signup", capacity: 20, selection: "mystery" })).toEqual(["Sign-up required", "20 places"]);
  });
});
