import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_STORY_LENGTH,
  MILESTONE_DEFAULT_VISIBILITY,
  MILESTONE_LEVEL_LINES,
  MILESTONE_CELEBRATION,
  MILESTONE_SHOWN,
  SHARE_STORY_DEFAULT,
  SHARE_STORY_LABEL,
  SHARE_STORY_NOTE,
  SHARE_STORY_TIP,
  describeMilestoneLevel,
  hasStory,
  milestoneDateWords,
  milestoneLevels,
  milestoneWebNote,
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
  it("confirms with the share consent off unless ticked", () => {
    expect(SHARE_STORY_DEFAULT).toBe(false);
    expect(parseMilestoneAnswer({ answer: "confirm" }, NOW)).toEqual({
      status: "confirmed",
      achievedOn: null,
      storyBefore: null,
      storyAfter: null,
      consent_testimonial: false,
    });
    expect(parseMilestoneAnswer({ answer: "confirm", storyAfter: "At last.", shareStory: true }, NOW)).toMatchObject({ consent_testimonial: true });
    expect(parseMilestoneAnswer({ answer: "confirm", storyAfter: "At last." }, NOW)).toMatchObject({ consent_testimonial: false });
    // Only a real `true` counts.
    expect(parseMilestoneAnswer({ answer: "confirm", storyAfter: "At last.", shareStory: "yes" as unknown as boolean }, NOW)).toMatchObject({ consent_testimonial: false });
  });

  it("never keeps the consent without a story to share, and a blank story is no story", () => {
    expect(parseMilestoneAnswer({ answer: "confirm", shareStory: true }, NOW)).toMatchObject({ consent_testimonial: false });
    expect(parseMilestoneAnswer({ answer: "confirm", storyBefore: "   ", shareStory: true }, NOW)).toMatchObject({ consent_testimonial: false });
    expect(parseMilestoneAnswer({ answer: "confirm", storyBefore: "Stuck.", shareStory: true }, NOW)).toMatchObject({ consent_testimonial: true });
  });

  it("trims the stories and treats blank as none", () => {
    expect(parseMilestoneAnswer({ answer: "confirm", storyBefore: "  Stuck.  ", storyAfter: "   ", achievedOn: " " }, NOW)).toMatchObject({
      storyBefore: "Stuck.",
      storyAfter: null,
      achievedOn: null,
    });
  });

  it("keeps nothing for a decline, whatever else was sent", () => {
    expect(parseMilestoneAnswer({ answer: "decline", storyAfter: "x", shareStory: true }, NOW)).toEqual({ status: "declined" });
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
  it("reads the kind and a confirmed answer, the share consent off unless ticked", () => {
    expect(parseMilestoneSelfAdd({ kind: "the_end" }, NOW)).toEqual({
      kind: "the_end",
      answer: { status: "confirmed", achievedOn: null, storyBefore: null, storyAfter: null, consent_testimonial: false },
    });
    expect(parseMilestoneSelfAdd({ kind: "publish_ready", achievedOn: "2026-05-01", storyAfter: "Done.", shareStory: true }, NOW)).toMatchObject({
      kind: "publish_ready",
      answer: { achievedOn: "2026-05-01", consent_testimonial: true },
    });
  });

  it("refuses the derived milestone, an unknown kind and a bad date", () => {
    expect(parseMilestoneSelfAdd({ kind: "published" }, NOW)).toHaveProperty("error");
    expect(parseMilestoneSelfAdd({ kind: undefined }, NOW)).toHaveProperty("error");
    expect(parseMilestoneSelfAdd({ kind: "the_end", achievedOn: "2999-01-01" }, NOW)).toHaveProperty("error");
  });
});

describe("the share consent and the visibility words", () => {
  it("keeps the agreed consent wording, with the marketing uses in the tip", () => {
    expect(SHARE_STORY_LABEL).toBe("Share my story to inspire other writers.");
    expect(SHARE_STORY_NOTE).toMatch(/we may feature it on the Quill & Cup website/);
    expect(SHARE_STORY_NOTE).toMatch(/you can change your mind any time/);
    expect(SHARE_STORY_TIP).toBe("For marketing: the Finishers section of our website, and testimonials we share.");
  });

  it("says something warm for each milestone and never promises sales or exposure", () => {
    expect(MILESTONE_CELEBRATION.the_end).toBe("You wrote THE END. We're so proud of you.");
    for (const kind of MILESTONE_KINDS) {
      expect(MILESTONE_CELEBRATION[kind].length).toBeGreaterThan(10);
      expect(MILESTONE_SHOWN[kind].length).toBeGreaterThan(5);
    }
    expect(`${SHARE_STORY_NOTE} ${SHARE_STORY_TIP}`).not.toMatch(/sales|sell|exposure|famous|guarantee/i);
  });

  it("offers the globe only where writer profiles are open", () => {
    expect(milestoneLevels(false)).toEqual(["private", "community"]);
    expect(milestoneLevels(true)).toEqual(["private", "community", "public"]);
  });

  it("describes who sees it now and where a click goes, and says the story goes with it", () => {
    expect(describeMilestoneLevel("private", "community")).toBe("Only you can see this milestone. The story you wrote goes with it. Click to show it to other members.");
    expect(describeMilestoneLevel("community", "public")).toMatch(/Other members can see this milestone on your profile\..*everyone on the internet/);
    expect(describeMilestoneLevel("public", "private")).toMatch(/Anyone on the internet can see this milestone.*Click to keep it to yourself/);
  });

  it("notes what the globe does right now, only at the globe", () => {
    expect(milestoneWebNote("community", { available: false, on: false })).toBeNull();
    expect(milestoneWebNote("public", { available: true, on: true })).toBeNull();
    expect(milestoneWebNote("public", { available: false, on: false })).toMatch(/not open to you yet/);
    expect(milestoneWebNote("public", { available: true, on: false })).toMatch(/once your writer profile is on/);
  });

  it("knows a story from blank, and writes a day as words without a zone", () => {
    expect(hasStory({ storyBefore: null, storyAfter: null })).toBe(false);
    expect(hasStory({ storyBefore: "  ", storyAfter: null })).toBe(false);
    expect(hasStory({ storyBefore: null, storyAfter: "Done." })).toBe(true);
    expect(milestoneDateWords("2026-05-01")).toBe("May 1, 2026");
  });
});

describe("where a milestone starts", () => {
  it("is the globe: a writer's page is good enough the day they switch it on, and the lock and house stay one click away", () => {
    expect(MILESTONE_DEFAULT_VISIBILITY).toBe("public");
    expect(MILESTONE_LEVEL_LINES.public).toBe("Anyone on the internet, once your writer profile is on; members see it now.");
    expect(Object.keys(MILESTONE_LEVEL_LINES)).toEqual(["private", "community", "public"]);
  });

  it("is the level the database trigger starts a confirmed milestone at (its latest definition in the migrations)", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const definitions = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((sql) => /FUNCTION public\.member_milestones_default_visibility\(\)/.test(sql));
    const latest = definitions[definitions.length - 1];
    expect(latest).toContain(`NEW.visibility := '${MILESTONE_DEFAULT_VISIBILITY}'`);
  });

  it("keeps the level a member picks with their answer, and refuses one that does not exist", () => {
    const answer = (visibility: string | null | undefined) => parseMilestoneAnswer({ answer: "confirm", visibility }, NOW);
    expect(answer("private")).toMatchObject({ status: "confirmed", visibility: "private" });
    expect(answer("community")).toMatchObject({ visibility: "community" });
    expect(answer("public")).toMatchObject({ visibility: "public" });
    // Not naming one leaves it to the default; the answer carries no level at all.
    expect(answer(undefined)).not.toHaveProperty("visibility");
    expect(answer(null)).not.toHaveProperty("visibility");
    expect(answer("everyone")).toEqual({ error: "That choice is not available." });
    expect(parseMilestoneSelfAdd({ kind: "the_end", visibility: "community" }, NOW)).toMatchObject({ kind: "the_end", answer: { visibility: "community" } });
    expect(parseMilestoneSelfAdd({ kind: "the_end", visibility: "nope" }, NOW)).toEqual({ error: "That choice is not available." });
  });
});
