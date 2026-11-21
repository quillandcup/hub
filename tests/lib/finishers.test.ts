import { describe, expect, it } from "vitest";
import {
  MAX_STORY_LENGTH,
  MILESTONE_CONSENTS,
  MILESTONE_KINDS,
  MILESTONE_LABELS,
  MILESTONE_TITLES,
  PUBLISH_READY_STAMP,
  isMilestoneKind,
  milestoneLabel,
  orgToday,
  parseMilestoneAnswer,
  parseMilestoneSelfAdd,
} from "@/lib/finishers";

const NOW = Date.parse("2026-11-20T15:00:00Z");

describe("milestone wording", () => {
  it("names each stored milestone once, with the second stamp in one string", () => {
    expect(MILESTONE_KINDS).toEqual(["the_end", "publish_ready"]);
    expect(MILESTONE_LABELS.the_end).toBe("THE END");
    expect(MILESTONE_LABELS.publish_ready).toBe(PUBLISH_READY_STAMP);
    expect(MILESTONE_TITLES).toEqual({ the_end: "Finisher", publish_ready: "Author" });
  });

  it("recognizes a kind and falls back for an unknown one", () => {
    expect(isMilestoneKind("the_end")).toBe(true);
    expect(isMilestoneKind("published")).toBe(false);
    expect(isMilestoneKind(null)).toBe(false);
    expect(milestoneLabel("the_end")).toBe("THE END");
    expect(milestoneLabel("published")).toBe("milestone");
  });
});

describe("orgToday", () => {
  it("is the Eastern date, not the UTC one, either side of midnight", () => {
    expect(orgToday(Date.parse("2026-11-20T04:30:00Z"))).toBe("2026-11-19"); // 23:30 Eastern the evening before
    expect(orgToday(Date.parse("2026-11-20T05:30:00Z"))).toBe("2026-11-20"); // 00:30 Eastern
  });

  it("follows daylight saving: the same UTC hour is a different Eastern day in March", () => {
    expect(orgToday(Date.parse("2027-03-14T04:30:00Z"))).toBe("2027-03-13"); // still EST, 23:30
    expect(orgToday(Date.parse("2027-03-14T05:30:00Z"))).toBe("2027-03-14"); // 00:30 EST
    expect(orgToday(Date.parse("2027-03-15T03:30:00Z"))).toBe("2027-03-14"); // now EDT, 23:30
  });
});

describe("parseMilestoneAnswer", () => {
  it("confirms with every consent off unless ticked", () => {
    expect(parseMilestoneAnswer({ answer: "confirm" }, NOW)).toEqual({
      status: "confirmed",
      achievedOn: null,
      storyBefore: null,
      storyAfter: null,
      consent_profile: false,
      consent_homepage: false,
      consent_testimonial: false,
    });
    const ticked = parseMilestoneAnswer({ answer: "confirm", consents: { consent_homepage: true } }, NOW);
    expect(ticked).toMatchObject({ consent_profile: false, consent_homepage: true, consent_testimonial: false });
    // Only a real `true` counts.
    expect(parseMilestoneAnswer({ answer: "confirm", consents: { consent_profile: "yes" as unknown as boolean } }, NOW)).toMatchObject({ consent_profile: false });
    expect(MILESTONE_CONSENTS.map((c) => c.key)).toEqual(["consent_profile", "consent_homepage", "consent_testimonial"]);
  });

  it("trims the stories and treats blank as none", () => {
    expect(parseMilestoneAnswer({ answer: "confirm", storyBefore: "  Stuck.  ", storyAfter: "   ", achievedOn: " " }, NOW)).toMatchObject({
      storyBefore: "Stuck.",
      storyAfter: null,
      achievedOn: null,
    });
  });

  it("keeps nothing for a decline, whatever else was sent", () => {
    expect(parseMilestoneAnswer({ answer: "decline", storyAfter: "x", consents: { consent_profile: true } }, NOW)).toEqual({ status: "declined" });
  });

  it("accepts today and earlier in the Eastern day, refuses tomorrow and nonsense dates", () => {
    const lateEvening = Date.parse("2026-11-20T04:30:00Z"); // 23:30 on the 19th, Eastern
    expect(parseMilestoneAnswer({ answer: "confirm", achievedOn: "2026-11-19" }, lateEvening)).toMatchObject({ achievedOn: "2026-11-19" });
    expect(parseMilestoneAnswer({ answer: "confirm", achievedOn: "2026-11-20" }, lateEvening)).toHaveProperty("error");
    expect(parseMilestoneAnswer({ answer: "confirm", achievedOn: "2026-02-30" }, NOW)).toHaveProperty("error");
    expect(parseMilestoneAnswer({ answer: "confirm", achievedOn: "last spring" }, NOW)).toHaveProperty("error");
  });

  it("refuses a story over the limit and an unknown answer", () => {
    expect(parseMilestoneAnswer({ answer: "confirm", storyAfter: "x".repeat(MAX_STORY_LENGTH) }, NOW)).toMatchObject({ status: "confirmed" });
    expect(parseMilestoneAnswer({ answer: "confirm", storyAfter: "x".repeat(MAX_STORY_LENGTH + 1) }, NOW)).toHaveProperty("error");
    expect(parseMilestoneAnswer({ answer: "maybe" as "confirm" }, NOW)).toHaveProperty("error");
  });
});

describe("parseMilestoneSelfAdd", () => {
  it("reads the kind and a confirmed answer, every consent off unless ticked", () => {
    expect(parseMilestoneSelfAdd({ kind: "the_end" }, NOW)).toEqual({
      kind: "the_end",
      answer: { status: "confirmed", achievedOn: null, storyBefore: null, storyAfter: null, consent_profile: false, consent_homepage: false, consent_testimonial: false },
    });
    expect(parseMilestoneSelfAdd({ kind: "publish_ready", achievedOn: "2026-05-01", consents: { consent_profile: true } }, NOW)).toMatchObject({
      kind: "publish_ready",
      answer: { achievedOn: "2026-05-01", consent_profile: true, consent_homepage: false },
    });
  });

  it("refuses the derived milestone, an unknown kind and a bad date", () => {
    expect(parseMilestoneSelfAdd({ kind: "published" }, NOW)).toHaveProperty("error");
    expect(parseMilestoneSelfAdd({ kind: undefined }, NOW)).toHaveProperty("error");
    expect(parseMilestoneSelfAdd({ kind: "the_end", achievedOn: "2999-01-01" }, NOW)).toHaveProperty("error");
  });
});
