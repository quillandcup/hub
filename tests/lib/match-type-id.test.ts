import { describe, expect, it } from "vitest";
import { matchTypeId, type MatchableType } from "@/lib/calendar-events";

const type = (id: string, name: string, normalized: string, aliases: string[] = []): MatchableType => ({
  id,
  name,
  normalized_name: normalized,
  summary_aliases: aliases,
});

const TYPES = [
  type("progress", "Progress Prickle", "progress"),
  type("heads", "Heads Down", "heads-down"),
  type("table", "Open Table", "open-table"),
  type("edu", "Educational Prickle", "educational", ["edu"]),
  type("holiday", "Q&C Holiday Party", "qc-holiday-party", ["quill-cup-holiday-party"]),
  type("spark", "Get Your Spark Back Prickle", "get-your-spark-back"),
  type("birthday", "Q&C Birthday Party", "qc-birthday-party"),
  type("challenge", "Quill & Cup Challenge", "quill-cup-challenge"),
];

describe("matchTypeId", () => {
  it.each([
    // The Holiday Party, as the community's calendar has written it over the years.
    ["Quill & Cup Holiday Party (AM)!", "holiday"],
    ["Quill & Cup Holiday Party (PM)!", "holiday"],
    ["QUILL & CUP HOLIDAY PARTY!", "holiday"],
    ["Q&C Holiday Party", "holiday"],
    // Get Your Spark Back, in each of its four forms.
    ["Quill & Cup Prickle: Get Your Spark Back with Q&C CEO Ania Ray", "spark"],
    ["Quill & Cup: Get Your Spark Back Prickle with Q&C CEO Ania Ray", "spark"],
    ["Quill & Cup: Get Your Spark Back Prickle with Ania", "spark"],
    ["Quill & Cup [Mindset] Prickle: Get Your Spark Back!", "spark"],
    ["Get Your Spark Back Prickle w/Ania", "spark"],
  ])("%s -> %s", (summary, id) => {
    expect(matchTypeId(summary, TYPES)).toBe(id);
  });

  it("still matches the shapes it always did", () => {
    expect(matchTypeId("Heads Down Prickle w/Cody", TYPES)).toBe("heads"); // the type part
    expect(matchTypeId("EDU-PRICKLE: Make It Funny w/Sam", TYPES)).toBe("edu"); // an alias
    expect(matchTypeId("Midnight Open Table w/Ada", TYPES)).toBe("table"); // a name the title contains
    expect(matchTypeId("Quill & Cup Challenge", TYPES)).toBe("challenge"); // a name that starts like the label
    expect(matchTypeId("Q&C Birthday Party", TYPES)).toBe("birthday");
  });

  it("makes a title with no type, or just Prickle, a Progress Prickle", () => {
    expect(matchTypeId("Prickle w/Lili", TYPES)).toBe("progress");
    expect(matchTypeId("", TYPES)).toBe("progress");
  });

  it("is null for a title no type is for, and for a title with no types to match", () => {
    expect(matchTypeId("Quill & Cup [Craft] Prickle: Something Entirely New", TYPES)).toBeNull();
    expect(matchTypeId("Heads Down Prickle", [])).toBeNull();
  });

  it("does not let a cleaned title match a type it only resembles", () => {
    expect(matchTypeId("Quill & Cup Prickle: Get Your Spark", TYPES)).toBeNull();
    expect(matchTypeId("Quill & Cup Holiday Brunch", TYPES)).toBeNull();
  });
});
