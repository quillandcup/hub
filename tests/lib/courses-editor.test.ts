import { describe, expect, it } from "vitest";
import { ACCESS_OPTIONS } from "@/lib/courses/access-options";
import { MAX_DESCRIPTION, MAX_SLUG, MAX_TITLE, parseCourseDetails, type CourseDetailsInput } from "@/lib/courses/editor";

const valid = (over: Partial<CourseDetailsInput> = {}): CourseDetailsInput => ({
  title: "The Ready Writer",
  slug: "",
  description: "",
  accessChoice: "1",
  launchOn: "",
  programId: "",
  ...over,
});
const ok = (over: Partial<CourseDetailsInput> = {}) => {
  const result = parseCourseDetails(valid(over));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
};
const errors = (over: Partial<CourseDetailsInput> = {}) => {
  const result = parseCourseDetails(valid(over));
  if (result.ok) throw new Error("expected errors");
  return result.errors;
};

describe("parseCourseDetails", () => {
  it("takes a name and an access length, and derives the address from the name", () => {
    expect(ok()).toEqual({ title: "The Ready Writer", slug: "the-ready-writer", description: null, access_duration: ACCESS_OPTIONS[1].value, launch_at: null, program_id: null });
  });

  it("trims, keeps a given address, and stores the description", () => {
    expect(ok({ title: "  Self-Editing Academy ", slug: " self-editing ", description: "  Edit like a pro.  " })).toMatchObject({
      title: "Self-Editing Academy",
      slug: "self-editing",
      description: "Edit like a pro.",
    });
  });

  it("makes an address of a name with an ampersand and accents", () => {
    expect(ok({ title: "Café & Quill!" }).slug).toBe("cafe-and-quill");
  });

  it("needs a name, and keeps it and the description to a size", () => {
    expect(errors({ title: "   " }).title).toBe("Give the course a name.");
    expect(errors({ title: "x".repeat(MAX_TITLE + 1) }).title).toMatch(/under 120/);
    expect(errors({ description: "x".repeat(MAX_DESCRIPTION + 1) }).description).toMatch(/under 2000/);
    expect(parseCourseDetails(valid({ title: "x".repeat(MAX_TITLE), slug: "x", description: "x".repeat(MAX_DESCRIPTION) })).ok).toBe(true);
  });

  it("only accepts an address of lowercase letters, numbers and single hyphens, up to a length", () => {
    for (const slug of ["Upper", "two  words", "a_b", "-lead", "trail-", "double--hyphen", "café"]) expect(errors({ slug }).slug, slug).toMatch(/lowercase letters/);
    expect(errors({ slug: "a".repeat(MAX_SLUG + 1) }).slug).toMatch(/under 60/);
    expect(ok({ slug: "a-1-b2" }).slug).toBe("a-1-b2");
  });

  it("cuts an address derived from a long name to fit, without a trailing hyphen", () => {
    const slug = ok({ title: `${"word ".repeat(20)}end` }).slug;
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG);
    expect(slug).toMatch(/^word(-word)*$/);
    expect(ok({ title: `${"a".repeat(MAX_SLUG - 1)} b` }).slug).toBe("a".repeat(MAX_SLUG - 1));
  });

  it("asks for an address when the name has nothing a link can be made of", () => {
    expect(errors({ title: "???" }).slug).toBe("Add an address (letters and numbers).");
    expect(ok({ title: "???", slug: "mystery" }).slug).toBe("mystery");
  });

  it("makes the access length an explicit choice from the list, lifetime included", () => {
    expect(errors({ accessChoice: "" }).accessChoice).toBe("Choose how long access lasts.");
    for (const bad of ["99", "-1", "abc", "1.5"]) expect(errors({ accessChoice: bad }).accessChoice, bad).toBeDefined();
    ACCESS_OPTIONS.forEach((option, i) => expect(ok({ accessChoice: String(i) }).access_duration).toBe(option.value));
    expect(ok({ accessChoice: "0" }).access_duration).toBeNull();
  });

  it("opens at midnight in the organisation's timezone on the chosen day, in either side of daylight saving", () => {
    // America/New_York: EDT (UTC-4) in summer, EST (UTC-5) in winter.
    expect(ok({ launchOn: "2026-07-01" }).launch_at).toBe("2026-07-01T04:00:00.000Z");
    expect(ok({ launchOn: "2026-12-01" }).launch_at).toBe("2026-12-01T05:00:00.000Z");
    // The day of the spring change is 23 hours long, but it still starts at midnight local time (EST then).
    expect(ok({ launchOn: "2027-03-14" }).launch_at).toBe("2027-03-14T05:00:00.000Z");
  });

  it("rejects a launch day that isn't a real day", () => {
    for (const bad of ["tomorrow", "2026-13-01", "2026-02-30x", "11/02/2026"]) expect(errors({ launchOn: bad }).launchOn, bad).toBe("Pick a day.");
  });

  it("takes a program by its id, or none", () => {
    expect(ok({ programId: "prg_AAAAAAAAAAA1" }).program_id).toBe("prg_AAAAAAAAAAA1");
    for (const bad of ["not-an-id", "mbr_AAAAAAAAAAA1", "00000000-0000-4000-a000-000000000001"]) expect(errors({ programId: bad }).programId, bad).toBeDefined();
  });

  it("reports every problem at once", () => {
    expect(Object.keys(errors({ title: "", accessChoice: "", launchOn: "x", programId: "x", slug: "Bad Slug" })).sort()).toEqual(["accessChoice", "launchOn", "programId", "slug", "title"]);
  });
});
