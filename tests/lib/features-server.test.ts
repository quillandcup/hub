import { describe, it, expect, vi, beforeEach } from "vitest";

// Which feature keys a user has on is resolved from three independent paths (global flag, per-user
// opt-in, segment targeting). These tests run the repositories over an in-memory dataset so each
// path can be isolated without real segment or member rows.

let dataset: InMemoryDataset;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...original, createRepos: () => original.createInMemoryRepos(dataset) };
});

import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySegmentRepository } from "@/lib/data/segments";
import { InMemoryFeatureFlagRepository } from "@/lib/data/feature-flags";
import {
  effectiveMemberHasFeature,
  getUserFeaturePreviews,
  isFeatureOnForEveryone,
  membersWithFeature,
  membersWithFeatureForOutreach,
} from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";

const at = "2026-10-30T10:00:00Z";
const flag = (feature_key: string, enabled_globally = false) => ({ feature_key, enabled_globally, created_at: at, updated_at: at });
const segment = (id: string) => ({ id, name: id, created_at: at, created_by: null });
const link = (feature_key: string, segment_id: string) => ({ feature_key, segment_id, created_at: at });
const inSegment = (segment_id: string, member_id: string) => ({ segment_id, member_id, added_at: at });
const preview = (user_id: string, feature_key: string) => ({ user_id, feature_key, enabled_at: at });

beforeEach(() => {
  vi.restoreAllMocks();
  dataset = new InMemoryDataset();
});

describe("getUserFeaturePreviews", () => {
  it("enables a flag that is on globally, even with no per-user or segment grant", async () => {
    dataset.featureFlags = [flag("work_queue", true), flag("events")];

    expect(await getUserFeaturePreviews("user-1")).toEqual(["work_queue"]);
  });

  it("enables a flag via the per-user opt-in override, independent of global/segment state", async () => {
    dataset.userFeaturePreviews = [preview("user-1", "program_cohorts"), preview("user-2", "events")];

    expect(await getUserFeaturePreviews("user-1")).toEqual(["program_cohorts"]);
  });

  it("enables a flag when the user's member is in a segment linked to that key", async () => {
    dataset.members = [{ id: "member-1", name: "Fern Quillsby", userId: "user-1" }];
    dataset.segments = [segment("seg-1"), segment("seg-2")];
    dataset.featureFlags = [flag("events"), flag("hedgieversaries")];
    dataset.featureFlagSegments = [
      link("events", "seg-1"),
      link("hedgieversaries", "seg-2"), // different segment: should NOT enable
    ];
    dataset.segmentMembers = [inSegment("seg-1", "member-1")];

    expect(await getUserFeaturePreviews("user-1")).toEqual(["events"]);
  });

  it("does not check segments at all when the user has no linked member", async () => {
    const segmentsOfMember = vi.spyOn(InMemorySegmentRepository.prototype, "segmentIdsForMember");
    const links = vi.spyOn(InMemoryFeatureFlagRepository.prototype, "segmentLinks");

    expect(await getUserFeaturePreviews("user-1")).toEqual([]);
    expect(segmentsOfMember).not.toHaveBeenCalled();
    expect(links).not.toHaveBeenCalled();
  });

  it("de-duplicates and combines all three enablement paths", async () => {
    dataset.members = [{ id: "member-1", name: "Fern Quillsby", userId: "user-1" }];
    dataset.segments = [segment("seg-1")];
    dataset.featureFlags = [flag("work_queue", true), flag("events")];
    dataset.userFeaturePreviews = [preview("user-1", "work_queue"), preview("user-1", "program_cohorts")];
    dataset.featureFlagSegments = [link("events", "seg-1")];
    dataset.segmentMembers = [inSegment("seg-1", "member-1")];

    const result = await getUserFeaturePreviews("user-1");
    expect(new Set(result)).toEqual(new Set(["work_queue", "program_cohorts", "events"]));
    expect(result).toHaveLength(3);
  });

  it("fails when the flags can't be read, rather than turning everything off", async () => {
    vi.spyOn(InMemoryFeatureFlagRepository.prototype, "globallyEnabledKeys").mockRejectedValueOnce(new Error("db down"));

    await expect(getUserFeaturePreviews("user-1")).rejects.toThrow("db down");
  });
});

describe("membersWithFeature", () => {
  const KEY = "browser_notifications" as FeatureKey;
  // m1 and m2 can sign in; m3 has no Hub account.
  const members = () => [
    { id: "m1", name: "Ada Example", userId: "u1" },
    { id: "m2", name: "Bea Example", userId: "u2" },
    { id: "m3", name: "Cy Example", userId: null },
  ];

  it("is everyone with an account when the flag is on globally", async () => {
    dataset.members = members();
    dataset.featureFlags = [flag(KEY, true)];

    expect(await membersWithFeature({}, KEY, ["m1", "m2", "m3"])).toEqual(new Set(["m1", "m2"]));
  });

  it("is members opted in individually or through a segment", async () => {
    dataset.members = members();
    dataset.segments = [segment("s1")];
    dataset.featureFlags = [flag(KEY)];
    dataset.userFeaturePreviews = [preview("u1", KEY), preview("u3", KEY)];
    dataset.featureFlagSegments = [link(KEY, "s1")];
    dataset.segmentMembers = [inSegment("s1", "m2"), inSegment("s1", "m3")];

    // m3 is in the segment but has no account, so they never count.
    expect(await membersWithFeature({}, KEY, ["m1", "m2", "m3"])).toEqual(new Set(["m1", "m2"]));
  });

  it("is nobody without the flag, and skips segment lookups when it has no segments", async () => {
    dataset.members = members();
    const inSegments = vi.spyOn(InMemorySegmentRepository.prototype, "memberIdsInSegments");

    expect(await membersWithFeature({}, KEY, ["m1", "m2"])).toEqual(new Set());
    expect(inSegments).toHaveBeenCalledWith([], ["m1", "m2"]);
  });

  it("asks about no members without reading anything", async () => {
    const flags = vi.spyOn(InMemoryFeatureFlagRepository.prototype, "isGloballyEnabled");

    expect(await membersWithFeature({}, KEY, [])).toEqual(new Set());
    expect(flags).not.toHaveBeenCalled();
  });

  it("only counts the previews for this key", async () => {
    dataset.members = members();
    dataset.userFeaturePreviews = [preview("u1", "events")];

    expect(await membersWithFeature({}, KEY, ["m1"])).toEqual(new Set());
  });
});

describe("membersWithFeatureForOutreach", () => {
  const KEY = "browser_notifications" as FeatureKey;

  it("covers every member given, signed in or not, when the flag is on globally", async () => {
    dataset.featureFlags = [flag(KEY, true)];

    expect(await membersWithFeatureForOutreach({}, KEY, ["m1", "m3"])).toEqual(new Set(["m1", "m3"]));
  });

  it("otherwise needs a segment or a preview, which need an account", async () => {
    dataset.members = [
      { id: "m1", name: "Ada Example", userId: "u1" },
      { id: "m3", name: "Cy Example", userId: null },
    ];
    dataset.userFeaturePreviews = [preview("u1", KEY)];

    expect(await membersWithFeatureForOutreach({}, KEY, ["m1", "m3"])).toEqual(new Set(["m1"]));
  });
});

describe("effectiveMemberHasFeature", () => {
  const KEY = "events" as FeatureKey;

  it("uses the signed-in user's own flags outside sudo", async () => {
    expect(await effectiveMemberHasFeature(KEY, { memberId: "m1", isSudo: false }, [KEY])).toBe(true);
    expect(await effectiveMemberHasFeature(KEY, { memberId: "m1", isSudo: false }, [])).toBe(false);
  });

  it("uses the sudo'd member's flags, not the admin's, in sudo", async () => {
    dataset.members = [{ id: "m1", name: "Ada Example", userId: "u1" }];
    dataset.userFeaturePreviews = [preview("u1", KEY)];

    expect(await effectiveMemberHasFeature(KEY, { memberId: "m1", isSudo: true }, [])).toBe(true);
    expect(await effectiveMemberHasFeature(KEY, { memberId: "m2", isSudo: true }, [KEY])).toBe(false);
  });
});

describe("isFeatureOnForEveryone", () => {
  it("is the global switch only, not segments or previews", async () => {
    dataset.featureFlags = [flag("courses", true), flag("events")];
    dataset.userFeaturePreviews = [preview("u1", "events")];

    expect(await isFeatureOnForEveryone({}, "courses" as FeatureKey)).toBe(true);
    expect(await isFeatureOnForEveryone({}, "events" as FeatureKey)).toBe(false);
    expect(await isFeatureOnForEveryone({}, "work_queue" as FeatureKey)).toBe(false);
  });

  it("names the flags table when it can't be read", async () => {
    vi.spyOn(InMemoryFeatureFlagRepository.prototype, "isGloballyEnabled").mockRejectedValueOnce(new Error("db down"));

    await expect(isFeatureOnForEveryone({}, "courses" as FeatureKey)).rejects.toThrow("feature_flags read failed: db down");
  });
});
