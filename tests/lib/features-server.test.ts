import { describe, it, expect, vi, beforeEach } from "vitest";

// getUserFeaturePreviews resolves effectively-enabled feature keys via three
// independent paths (global flag, per-user opt-in, segment targeting). These
// are unit tests against a mocked Supabase client so each path can be
// isolated without needing real segment/member rows.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { getUserFeaturePreviews } from "@/lib/features.server";
import { createClient } from "@/lib/supabase/server";

type TableResult = { data: unknown[] | null; error: { message: string } | null };

function makeBuilder(result: TableResult, terminal: "maybeSingle" | "await" = "await") {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: any) => resolve(result),
  };
  if (terminal === "maybeSingle") {
    builder.maybeSingle = () => Promise.resolve({ data: (result.data ?? [])[0] ?? null, error: result.error });
  }
  return builder;
}

function makeSupabaseMock(tables: Record<string, TableResult>, memberId: string | null) {
  return {
    from: vi.fn((table: string) => {
      if (table === "members") {
        return makeBuilder({ data: memberId ? [{ id: memberId }] : [], error: null }, "maybeSingle");
      }
      return makeBuilder(tables[table] ?? { data: [], error: null });
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserFeaturePreviews", () => {
  it("enables a flag that is on globally, even with no per-user or segment grant", async () => {
    const mock = makeSupabaseMock(
      {
        feature_flags: { data: [{ feature_key: "work_queue" }], error: null },
        user_feature_previews: { data: [], error: null },
      },
      null
    );
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await getUserFeaturePreviews("user-1");
    expect(result).toEqual(["work_queue"]);
  });

  it("enables a flag via the per-user opt-in override, independent of global/segment state", async () => {
    const mock = makeSupabaseMock(
      {
        feature_flags: { data: [], error: null },
        user_feature_previews: { data: [{ feature_key: "program_cohorts" }], error: null },
      },
      null
    );
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await getUserFeaturePreviews("user-1");
    expect(result).toEqual(["program_cohorts"]);
  });

  it("enables a flag when the user's member is in a segment linked to that key", async () => {
    const mock = makeSupabaseMock(
      {
        feature_flags: { data: [], error: null },
        user_feature_previews: { data: [], error: null },
        feature_flag_segments: {
          data: [
            { feature_key: "events", segment_id: "seg-1" },
            { feature_key: "hedgieversaries", segment_id: "seg-2" }, // different segment — should NOT enable
          ],
          error: null,
        },
        segment_members: { data: [{ segment_id: "seg-1" }], error: null },
      },
      "member-1"
    );
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await getUserFeaturePreviews("user-1");
    expect(result).toEqual(["events"]);
  });

  it("does not check segments at all when the user has no linked member", async () => {
    const mock = makeSupabaseMock(
      {
        feature_flags: { data: [], error: null },
        user_feature_previews: { data: [], error: null },
      },
      null
    );
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await getUserFeaturePreviews("user-1");
    expect(result).toEqual([]);
    expect(mock.from).not.toHaveBeenCalledWith("feature_flag_segments");
    expect(mock.from).not.toHaveBeenCalledWith("segment_members");
  });

  it("de-duplicates and combines all three enablement paths", async () => {
    const mock = makeSupabaseMock(
      {
        feature_flags: { data: [{ feature_key: "work_queue" }], error: null },
        user_feature_previews: { data: [{ feature_key: "work_queue" }, { feature_key: "program_cohorts" }], error: null },
        feature_flag_segments: { data: [{ feature_key: "events", segment_id: "seg-1" }], error: null },
        segment_members: { data: [{ segment_id: "seg-1" }], error: null },
      },
      "member-1"
    );
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await getUserFeaturePreviews("user-1");
    expect(new Set(result)).toEqual(new Set(["work_queue", "program_cohorts", "events"]));
    expect(result).toHaveLength(3);
  });
});
