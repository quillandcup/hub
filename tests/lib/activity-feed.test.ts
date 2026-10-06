import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorDisplay,
  actorName,
  changedFields,
  describeRow,
  feedSearch,
  fetchActivityFeed,
  parseFeedFilters,
  type ActivityFeedRow,
} from "@/lib/activity-feed";

const ACTOR = "00000000-0000-4000-a000-0000000000a1";

function row(overrides: Partial<ActivityFeedRow>): ActivityFeedRow {
  return {
    event_id: "audit:1",
    kind: "audit",
    occurred_at: "2026-10-05T12:00:00Z",
    is_audit: true,
    actor_user_id: ACTOR,
    actor_kind: "staff",
    actor_label: "Bramble Admin",
    member_id: null,
    member_name: null,
    acting_as_member_id: null,
    acting_as_member_name: null,
    event_type: "update",
    entity_type: "prickle_type",
    entity_id: "x",
    title: null,
    description: null,
    source: "audit_log",
    data: null,
    ...overrides,
  };
}

describe("parseFeedFilters", () => {
  it("defaults to the audit view over the last 7 days", () => {
    expect(parseFeedFilters({})).toEqual({
      view: "audit",
      kinds: null,
      actorUserId: null,
      memberId: null,
      sudoOnly: false,
      days: 7,
    });
  });

  it("accepts known values and drops junk", () => {
    const f = parseFeedFilters({
      view: "all",
      kinds: "session,bogus,audit",
      actor: ACTOR,
      member: "not-a-uuid",
      days: "30",
      sudo: "1",
    });
    expect(f).toMatchObject({
      view: "all",
      kinds: ["session", "audit"],
      actorUserId: ACTOR,
      memberId: null,
      sudoOnly: true,
      days: 30,
    });
    expect(parseFeedFilters({ days: "9999", sudo: "yes" })).toMatchObject({ days: 7, sudoOnly: false });
  });
});

describe("feedSearch", () => {
  it("omits defaults and round-trips through parseFeedFilters", () => {
    expect(feedSearch(parseFeedFilters({}))).toBe("");
    const filters = parseFeedFilters({ view: "all", kinds: "activity", actor: ACTOR, days: "90", sudo: "1" });
    expect(parseFeedFilters(Object.fromEntries(new URLSearchParams(feedSearch(filters))))).toEqual(filters);
  });
});

describe("describeRow", () => {
  it("names the changed fields of an update", () => {
    const r = row({ data: { status: { old: "lead", new: "active" }, name: { old: "A", new: "B" } } });
    expect(describeRow(r)).toBe("changed prickle type — status, name");
    expect(changedFields(r.data).map(([k]) => k)).toEqual(["status", "name"]);
  });

  it("uses verbs for insert and delete and caps long field lists", () => {
    expect(describeRow(row({ event_type: "insert", data: { a: { old: null, new: 1 } } }))).toBe("added prickle type");
    expect(describeRow(row({ event_type: "delete" }))).toBe("removed prickle type");
    const many = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, { old: 1, new: 2 }]));
    expect(describeRow(row({ data: many }))).toBe("changed prickle type — a, b, c, d, +2 more");
  });

  it("summarizes sessions and activities", () => {
    expect(describeRow(row({ kind: "session", data: { pages: ["/a", "/b"] } }))).toBe("visited 2 pages");
    expect(describeRow(row({ kind: "session", data: { pages: ["/a"] } }))).toBe("visited 1 page");
    expect(describeRow(row({ kind: "session", data: { pages: [] } }))).toBe("was active (no page views)");
    expect(describeRow(row({ kind: "activity", title: "Attended Morning Writing" }))).toBe("Attended Morning Writing");
  });
});

describe("actorName", () => {
  it("falls back sensibly", () => {
    expect(actorName(row({ actor_kind: "system", actor_label: null }))).toBe("System");
    expect(actorName(row({ actor_label: null }))).toBe("A staff member");
    expect(actorName(row({ actor_kind: "member", actor_label: null }))).toBe("A member");
  });
});

describe("actorDisplay", () => {
  it("names who the admin was acting as in sudo", () => {
    expect(actorDisplay(row({}))).toBe("Bramble Admin");
    expect(actorDisplay(row({ acting_as_member_id: "m1", acting_as_member_name: "Fern Quillsby" }))).toBe(
      "Bramble Admin (as Fern Quillsby)"
    );
  });
});

describe("fetchActivityFeed", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const query = (extra: Record<string, string> = {}, page = 1, pageSize = 50) => ({
    ...parseFeedFilters(extra),
    page,
    pageSize,
  });

  function client(total: number | null, rows: unknown[] = [], error: unknown = null) {
    const rpc = vi.fn(async (name: string) =>
      name === "count_activity_feed" ? { data: total, error: null } : { data: rows, error }
    );
    return { supabase: { rpc } as unknown as SupabaseClient, rpc };
  }

  it("counts first, then fetches the requested page by offset", async () => {
    const { supabase, rpc } = client(120, [row({})]);
    const result = await fetchActivityFeed(supabase, query({}, 3, 50), now);
    expect(result).toMatchObject({ total: 120, page: 3, pageSize: 50 });
    expect(rpc).toHaveBeenNthCalledWith(1, "count_activity_feed", expect.objectContaining({ p_audit_only: true }));
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_activity_feed",
      expect.objectContaining({ p_offset: 100, p_limit: 50, p_from: "2026-09-29T12:00:00.000Z" })
    );
  });

  it("clamps a page past the end to the last page", async () => {
    const { supabase, rpc } = client(60, [row({})]);
    const result = await fetchActivityFeed(supabase, query({}, 99, 50), now);
    expect(result.page).toBe(2);
    expect(rpc).toHaveBeenLastCalledWith("get_activity_feed", expect.objectContaining({ p_offset: 50 }));
  });

  it("skips the row query when nothing matches and passes filters through", async () => {
    const { supabase, rpc } = client(0);
    const result = await fetchActivityFeed(supabase, query({ view: "all", actor: ACTOR, sudo: "1" }), now);
    expect(result).toMatchObject({ rows: [], total: 0, page: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "count_activity_feed",
      expect.objectContaining({ p_audit_only: false, p_actor_user_id: ACTOR, p_sudo_only: true })
    );
  });

  it("surfaces errors", async () => {
    const failing = client(5, [], new Error("boom"));
    await expect(fetchActivityFeed(failing.supabase, query(), now)).rejects.toThrow("boom");
  });
});
