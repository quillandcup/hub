import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorDisplay,
  actorName,
  changedFields,
  describeRow,
  feedSearch,
  fetchActivityFeed,
  pageLabel,
  parseFeedFilters,
  summarizePages,
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
    expect(describeRow(r)).toBe("changed prickle type “B” — status, name");
    expect(changedFields(r.data).map(([k]) => k)).toEqual(["status", "name"]);
  });

  it("uses verbs for insert and delete and caps long field lists", () => {
    expect(describeRow(row({ event_type: "insert", data: { a: { old: null, new: 1 } } }))).toBe("added prickle type");
    expect(describeRow(row({ event_type: "delete" }))).toBe("removed prickle type");
    const many = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, { old: 1, new: 2 }]));
    expect(describeRow(row({ data: many }))).toBe("changed prickle type — a, b, c, d, +2 more");
  });

  it("summarizes sessions and activities", () => {
    expect(describeRow(row({ kind: "session", data: { pages: ["/a", "/b"] } }))).toBe("visited 2 pages (A ×1, B ×1)");
    expect(describeRow(row({ kind: "session", data: { pages: ["/a"] } }))).toBe("visited 1 page");
    expect(describeRow(row({ kind: "session", data: { pages: [] } }))).toBe("was active (no page views)");
    expect(describeRow(row({ kind: "activity", title: "Attended Morning Writing" }))).toBe("Attended Morning Writing");
  });
});

describe("describeRow for member actions", () => {
  const change = (o: unknown, n: unknown) => ({ old: o, new: n });

  it("names the record and uses model-level labels", () => {
    const r = row({ entity_type: "writing_project", event_type: "insert", data: { title: change(null, "Moon Garden") } });
    expect(describeRow(r)).toBe("added writing project “Moon Garden”");
    const del = row({ entity_type: "member_book", event_type: "delete", data: { title: change("Old Title", null) } });
    expect(describeRow(del)).toBe("removed “Old Title” from their bookshelf");
  });

  it("reads calendar link and wheel events as sentences", () => {
    const cal = (event_type: string, data: Record<string, unknown>) =>
      describeRow(row({ entity_type: "calendar_feed", event_type, data }));
    expect(cal("insert", { token: change(null, "[redacted]") })).toBe("created their calendar link");
    expect(cal("update", { first_fetched_at: change(null, "2026-10-06T00:00:00Z") })).toBe(
      "added their calendar link to a calendar app"
    );
    expect(cal("update", { token: change("[redacted]", "[redacted]"), first_fetched_at: change("x", null) })).toBe(
      "generated a new calendar link"
    );
    expect(describeRow(row({ entity_type: "wheel_of_wonder_match", event_type: "insert", data: {} }))).toBe(
      "spun the Wheel of Wonder"
    );
  });
});

describe("describeRow for projects, books and check-ins", () => {
  const change = (o: unknown, n: unknown) => ({ old: o, new: n });

  it("names the record on an update and spells out a status change", () => {
    const r = row({
      entity_type: "writing_project",
      description: "Moon Garden",
      data: { phase: change("drafting", "on_hold") },
    });
    expect(describeRow(r)).toBe("moved writing project “Moon Garden” from drafting to on hold");
  });

  it("tells a book published from a project from one added directly", () => {
    const book = (project_id: string | null) =>
      row({
        entity_type: "member_book",
        event_type: "insert",
        description: "Moon Garden",
        data: { title: change(null, "Moon Garden"), project_id: change(null, project_id) },
      });
    expect(describeRow(book("p1"))).toBe("published “Moon Garden” from a writing project");
    expect(describeRow(book(null))).toBe("added “Moon Garden” to their bookshelf");
  });

  it("shows the channel of a check-in or check-out", () => {
    const a = (via: string) =>
      row({ kind: "activity", event_type: "prickle_checkin", title: "Checked in to Morning Writing", data: { via } });
    expect(describeRow(a("slack"))).toBe("Checked in to Morning Writing (via Slack)");
    expect(describeRow(a("web"))).toBe("Checked in to Morning Writing (via web)");
  });
});

describe("pageLabel / summarizePages", () => {
  it("turns paths into places", () => {
    expect(pageLabel("/")).toBe("Home");
    expect(pageLabel("/dashboard")).toBe("Dashboard");
    expect(pageLabel("/my-prickles/all?commit=1")).toBe("My Prickles · All");
    expect(pageLabel("/prickles/aab9da99-7d3d-401b-bbdf-8f40747c011d")).toBe("Prickles · one");
  });

  it("counts places, most visited first", () => {
    expect(summarizePages(["/projects", "/dashboard", "/projects", "/prickles/aab9da99-7d3d-401b-bbdf-8f40747c011d"])).toEqual([
      { label: "Projects", count: 2 },
      { label: "Dashboard", count: 1 },
      { label: "Prickles · one", count: 1 },
    ]);
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
