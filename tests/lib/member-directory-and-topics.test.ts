import { describe, it, expect } from "vitest";
import { filterDirectory, type DirectoryEntry } from "@/lib/member-directory";
import { MAX_TOPICS, MAX_TOPIC_LENGTH, normalizeTopics, splitTopicInput } from "@/lib/ask-me-about";

function entry(overrides: Partial<DirectoryEntry>): DirectoryEntry {
  return {
    id: "m",
    displayName: "Someone",
    photoUrl: null,
    bio: null,
    firstJoinedAt: null,
    projects: [],
    topics: [],
    myNote: null,
    ...overrides,
  };
}

const ZOE = entry({ id: "zoe", displayName: "Zoë Thornfield", projects: ["The Lantern Keeper"], topics: ["cozy mysteries"] });
const PAT = entry({ id: "pat", displayName: "Pat Quill", bio: "Romance writer, mother of hedgehogs", myNote: "met at NaNo" });

describe("filterDirectory", () => {
  it("returns everyone for a blank query", () => {
    expect(filterDirectory([ZOE, PAT], "   ")).toEqual([ZOE, PAT]);
  });

  it("matches name, project, topic, bio and the viewer's own note, ignoring case and accents", () => {
    expect(filterDirectory([ZOE, PAT], "zoe")).toEqual([ZOE]);
    expect(filterDirectory([ZOE, PAT], "lantern")).toEqual([ZOE]);
    expect(filterDirectory([ZOE, PAT], "COZY")).toEqual([ZOE]);
    expect(filterDirectory([ZOE, PAT], "romance")).toEqual([PAT]);
    expect(filterDirectory([ZOE, PAT], "nano")).toEqual([PAT]);
  });

  it("requires every word to match somewhere", () => {
    expect(filterDirectory([ZOE, PAT], "zoe mysteries")).toEqual([ZOE]);
    expect(filterDirectory([ZOE, PAT], "zoe romance")).toEqual([]);
  });
});

describe("ask-me-about topics", () => {
  it("splits typed input on commas and newlines", () => {
    expect(splitTopicInput(" cozy  mysteries,querying agents\nworldbuilding,, ")).toEqual([
      "cozy mysteries",
      "querying agents",
      "worldbuilding",
    ]);
  });

  it("normalizes: trims, drops blanks and case-insensitive duplicates, keeps order", () => {
    expect(normalizeTopics([" Plot ", "", "plot", "Pacing"])).toEqual({ topics: ["Plot", "Pacing"] });
  });

  it("rejects overlong topics and too many topics", () => {
    expect(normalizeTopics(["x".repeat(MAX_TOPIC_LENGTH + 1)])).toHaveProperty("error");
    expect(normalizeTopics(Array.from({ length: MAX_TOPICS + 1 }, (_, i) => `t${i}`))).toHaveProperty("error");
    expect(normalizeTopics(Array.from({ length: MAX_TOPICS }, (_, i) => `t${i}`))).not.toHaveProperty("error");
  });
});
