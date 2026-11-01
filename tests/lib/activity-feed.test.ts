import { describe, it, expect, vi } from "vitest";
import { createInMemoryRepos } from "@/lib/data/repos";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorDisplay,
  actorName,
  changedFields,
  describeRow,
  MEMBER_DEFAULTS,
  feedSearch,
  fetchActivityFeed,
  fetchRecordHistory,
  pageLabel,
  parseFeedFilters,
  summarizePages,
  type ActivityFeedRow,
} from "@/lib/activity-feed";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

vi.mock("@/lib/chat/names", () => ({
  withMentionNames: async (rows: { description?: string | null }[]) =>
    rows.map((r) => ({ ...r, description: r.description?.replace("<@U1>", "@Fern") ?? r.description })),
}));

const ACTOR ="00000000-0000-4000-a000-0000000000a1";

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
      hideSystem: false,
      hideSlack: false,
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

  it("reads the hide-system toggle", () => {
    expect(parseFeedFilters({ nosystem: "1" }).hideSystem).toBe(true);
    expect(parseFeedFilters({ nosystem: "yes" }).hideSystem).toBe(false);
    expect(feedSearch(parseFeedFilters({ nosystem: "1" }))).toBe("?nosystem=1");
  });

  it("reads the hide-Slack toggle", () => {
    expect(parseFeedFilters({ noslack: "1" }).hideSlack).toBe(true);
    expect(parseFeedFilters({ noslack: "yes" }).hideSlack).toBe(false);
    expect(feedSearch(parseFeedFilters({ noslack: "1" }))).toBe("?noslack=1");
  });

  it("accepts the privacy view and keeps it in the URL", () => {
    const filters = parseFeedFilters({ view: "privacy" });
    expect(filters.view).toBe("privacy");
    expect(feedSearch(filters)).toBe("?view=privacy");
    expect(parseFeedFilters({ view: "bogus" }).view).toBe("audit");
  });
});

describe("feedSearch", () => {
  it("omits defaults and round-trips through parseFeedFilters", () => {
    expect(feedSearch(parseFeedFilters({}))).toBe("");
    const filters = parseFeedFilters({ view: "all", kinds: "activity", actor: ACTOR, days: "90", sudo: "1", nosystem: "1" });
    expect(parseFeedFilters(Object.fromEntries(new URLSearchParams(feedSearch(filters))))).toEqual(filters);
  });
});

describe("member defaults", () => {
  it("default to Everything over 90 days and keep the URL clean", () => {
    const filters = parseFeedFilters({}, MEMBER_DEFAULTS);
    expect(filters.view).toBe("all");
    expect(filters.days).toBe(90);
    expect(feedSearch(filters, MEMBER_DEFAULTS)).toBe("");
  });

  it("writes only what differs from them, and reads the audit view back", () => {
    const filters = parseFeedFilters({ view: "audit", days: "7", nosystem: "1", noslack: "1" }, MEMBER_DEFAULTS);
    expect(filters).toMatchObject({ view: "audit", days: 7, hideSystem: true, hideSlack: true });
    expect(feedSearch(filters, MEMBER_DEFAULTS)).toBe("?view=audit&nosystem=1&noslack=1&days=7");
    expect(parseFeedFilters(Object.fromEntries(new URLSearchParams(feedSearch(filters, MEMBER_DEFAULTS))), MEMBER_DEFAULTS)).toEqual(filters);
  });

  it("leaves the central log's defaults alone", () => {
    expect(parseFeedFilters({}).view).toBe("audit");
    expect(feedSearch(parseFeedFilters({ view: "all" }))).toBe("?view=all");
  });
});

describe("describeRow", () => {
  it("names the changed fields of an update", () => {
    const r = row({ data: { status: { old: "lead", new: "active" }, name: { old: "A", new: "B" } } });
    expect(describeRow(r)).toBe("changed prickle type “B” — status, name");
    expect(changedFields(r.data).map(([k]) => k)).toEqual(["status", "name"]);
  });

  it("reads a course reorder as one sentence: how many, of what, and in which module or course", () => {
    const order = { order: { old: ["a", "b", "c", "d"], new: ["d", "c", "b", "a"] } };
    expect(describeRow(row({ entity_type: "course_lesson_order", description: "Week 1", data: order }))).toBe("reordered the 4 lessons in “Week 1”");
    expect(describeRow(row({ entity_type: "course_module_order", description: "The Ready Writer", data: order }))).toBe("reordered the 4 modules in “The Ready Writer”");
    expect(describeRow(row({ entity_type: "course_lesson_order", description: null, data: {} }))).toBe("reordered the lessons");
  });

  it("uses verbs for insert and delete and caps long field lists", () => {
    expect(describeRow(row({ event_type: "insert", data: { a: { old: null, new: 1 } } }))).toBe("added prickle type");
    expect(describeRow(row({ event_type: "delete" }))).toBe("removed prickle type");
    const many = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, { old: 1, new: 2 }]));
    expect(describeRow(row({ data: many }))).toBe("changed prickle type — a, b, c, d, +2 more");
  });

  it("names records that are labelled by what they point at", () => {
    const r = row({ event_type: "insert", entity_type: "segment_member", description: "Cohort A", data: { member_id: { old: null, new: "m1" } } });
    expect(describeRow(r)).toBe("added segment membership “Cohort A”");
  });

  it("says who was added to or removed from an event", () => {
    const base = { entity_type: "event_attendee", description: "Autumn Retreat", member_name: "Moss Bramble" };
    expect(describeRow(row({ ...base, event_type: "insert" }))).toBe("added Moss Bramble as an attendee of “Autumn Retreat”");
    expect(describeRow(row({ ...base, event_type: "delete" }))).toBe("removed Moss Bramble as an attendee of “Autumn Retreat”");
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

  it("reads channel restriction changes as sentences", () => {
    const restriction = (event_type: string) =>
      describeRow(row({ entity_type: "restricted_slack_channel", event_type, description: "inner-circle", data: {} }));
    expect(restriction("insert")).toBe("restricted staff access to messages in #inner-circle");
    expect(restriction("delete")).toBe("lifted the restriction on messages in #inner-circle");
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

  it("reads a soft delete as a delete, and clearing it as a restore", () => {
    const update = (entity_type: string, deleted_at: { old: unknown; new: unknown }) =>
      row({ entity_type, event_type: "update", description: "Moon Garden", data: { deleted_at } });
    const when = "2026-10-29T10:00:00Z";
    expect(describeRow(update("member_book", change(null, when)))).toBe("removed “Moon Garden” from their bookshelf");
    expect(describeRow(update("member_book", change(when, null)))).toBe("put “Moon Garden” back on their bookshelf");
    expect(describeRow(update("writing_goal", change(null, when)))).toBe("deleted writing goal “Moon Garden”");
    expect(describeRow(update("member_award", change(when, null)))).toBe("restored award “Moon Garden”");
    // Any other change to the same row is still an ordinary update.
    expect(describeRow(row({ entity_type: "writing_goal", event_type: "update", data: { target_amount: change(1, 2) } }))).toBe("changed writing goal — target amount");
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
    expect(pageLabel("/prickles/prkl_7Kx2mQ9dFh3N")).toBe("Prickles · one");
  });

  it("counts places, most visited first", () => {
    expect(summarizePages(["/projects", "/dashboard", "/projects", "/prickles/prkl_7Kx2mQ9dFh3N"])).toEqual([
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

  it("returns the rows with Slack mentions in descriptions resolved to names", async () => {
    const { supabase } = client(1, [row({ description: "<@U1> hello" })]);
    const result = await fetchActivityFeed(supabase, query(), now);
    expect(result.rows[0].description).toBe("@Fern hello");
  });

  it("shows members by display name, falling back to the legal name", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E" },
          { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", displayName: null },
        ],
      })
    );
    const { supabase } = client(2, [
      row({ actor_kind: "member", actor_label: "Ada Example", member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada Example", acting_as_member_id: "mbr_AAAAAAAAAAA2", acting_as_member_name: "Bo Example" }),
      row({ actor_label: "Bramble Admin", member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada Example" }),
    ]);
    const { rows } = await fetchActivityFeed(supabase, query(), now);
    expect(rows[0]).toMatchObject({ member_name: "Ada E", actor_label: "Ada E", acting_as_member_name: "Bo Example" });
    expect(rows[1]).toMatchObject({ member_name: "Ada E", actor_label: "Bramble Admin" });
  });

  it("labels a staff actor by their member's display name when the label was their legal name, and leaves an email label", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", userId: "00000000-0000-4000-8000-000000000001" },
          { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", displayName: null, userId: "00000000-0000-4000-8000-000000000002" },
        ],
      })
    );
    const { supabase } = client(3, [
      row({ actor_kind: "staff", actor_user_id: "00000000-0000-4000-8000-000000000001", actor_label: "Ada Example" }),
      row({ actor_kind: "staff", actor_user_id: "00000000-0000-4000-8000-000000000001", actor_label: "ada@example.test" }),
      row({ actor_kind: "staff", actor_user_id: "00000000-0000-4000-8000-000000000002", actor_label: "Bo Example" }),
    ]);
    const { rows } = await fetchActivityFeed(supabase, query(), now);
    expect(rows.map((r) => r.actor_label)).toEqual(["Ada E", "ada@example.test", "Bo Example"]);
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

describe("fetchRecordHistory", () => {
  it("shows members by display name, falling back to the legal name", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E" },
          { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", displayName: null },
        ],
      })
    );
    const rpc = vi.fn(async () => ({
      data: [
        row({ actor_kind: "member", actor_label: "Ada Example", member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada Example", description: "<@U1> hi" }),
        row({ member_id: "mbr_AAAAAAAAAAA2", member_name: "Bo Example" }),
      ],
      error: null,
    }));
    const rows = await fetchRecordHistory({ rpc } as unknown as SupabaseClient, ["member"], "mbr_AAAAAAAAAAA1");
    expect(rows[0]).toMatchObject({ member_name: "Ada E", actor_label: "Ada E", description: "@Fern hi" });
    expect(rows[1]).toMatchObject({ member_name: "Bo Example" });
  });
});
