import { describe, it, expect, vi } from "vitest";
import { MILESTONE_LABELS } from "@/lib/finishers";
import { createInMemoryRepos } from "@/lib/data/repos";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALL_TIME_DAYS,
  actorDisplay,
  describeFeedWindow,
  feedWindow,
  actorName,
  changedFields,
  describeRow,
  emailLinkOf,
  MEMBER_DEFAULTS,
  feedSearch,
  fetchActivityFeed,
  limitedFeedFilters,
  fetchRecordHistory,
  pageLabel,
  parseFeedFilters,
  PRIVACY_ENTITY_TYPES,
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
    expect(parseFeedFilters({ view: "all", kinds: "note" }).kinds).toEqual(["note"]);
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

describe("emailLinkOf", () => {
  it("returns the Resend address of an email activity", () => {
    expect(emailLinkOf({ resend_url: "https://resend.com/emails/4ef9a417-02e9-4d39-ad75-9611e0fcc33c" })).toBe(
      "https://resend.com/emails/4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    );
  });

  it("returns nothing for any other address, so stored data can't send an admin elsewhere", () => {
    expect(emailLinkOf({ resend_url: "https://evil.example.com/emails/abc" })).toBeNull();
    expect(emailLinkOf({ resend_url: "https://resend.com.evil.example/emails/abc" })).toBeNull();
    expect(emailLinkOf({ resend_url: "javascript:alert(1)" })).toBeNull();
    expect(emailLinkOf({ resend_url: "https://resend.com/emails/abc/../../x" })).toBeNull();
    expect(emailLinkOf({ resend_url: 5 })).toBeNull();
    expect(emailLinkOf({})).toBeNull();
    expect(emailLinkOf(null)).toBeNull();
  });
});

describe("describeRow", () => {
  it("calls a staff note 'added a note'", () => {
    expect(describeRow(row({ kind: "note", event_type: "note", title: "Note", description: "Sent a DM" }))).toBe("added a note");
  });

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
    expect(describeRow(row({ entity_type: "writing_project_order", data: { order: { old: ["a", "b", "c"], new: ["c", "a", "b"] } } }))).toBe("reordered their 3 writing projects");
    expect(describeRow(row({ entity_type: "writing_project_order", data: {} }))).toBe("reordered their writing projects");
    expect(describeRow(row({ entity_type: "writing_goal_order", data: { order: { old: ["a", "b"], new: ["b", "a"] } } }))).toBe("reordered the 2 goals in a writing project");
    expect(describeRow(row({ entity_type: "writing_goal_order", data: {} }))).toBe("reordered the goals in a writing project");
  });

  it("reads staff moderation of a lesson comment as one sentence with the lesson, never text", () => {
    const entry = (data: Record<string, unknown>) => row({ entity_type: "lesson_comment", description: "Lesson <1> & more", data });
    expect(describeRow(entry({ visibility: { old: "visible", new: "hidden" }, reports_resolved: { old: 2, new: 0 } }))).toBe("hid a comment on “Lesson <1> & more”, settling its reports");
    expect(describeRow(entry({ visibility: { old: "held", new: "hidden" } }))).toBe("hid a comment on “Lesson <1> & more”");
    expect(describeRow(entry({ visibility: { old: "visible", new: "deleted" } }))).toBe("deleted a comment on “Lesson <1> & more”");
    expect(describeRow(entry({ visibility: { old: "held", new: "visible" } }))).toBe("approved a held comment on “Lesson <1> & more”");
    expect(describeRow(entry({ visibility: { old: "hidden", new: "visible" } }))).toBe("showed a hidden comment again on “Lesson <1> & more”");
    expect(describeRow(entry({ handled: { old: false, new: true } }))).toBe("marked a question as handled on “Lesson <1> & more”");
    expect(describeRow(entry({ reports_resolved: { old: 1, new: 0 } }))).toBe("dismissed the reports on a comment on “Lesson <1> & more”");
    expect(describeRow(row({ entity_type: "lesson_comment", description: null, data: { visibility: { old: "visible", new: "hidden" } } }))).toBe("hid a comment");
  });

  it("reads a duplicated course as one sentence with what it holds", () => {
    const data = { copied_from: { old: null, new: "crs_AAAAAAAAAAA1" }, lessons_copied: { old: null, new: 12 } };
    expect(describeRow(row({ entity_type: "course", event_type: "insert", description: "Plot Lab (copy)", data }))).toBe("duplicated a course as “Plot Lab (copy)” (12 lessons)");
    expect(describeRow(row({ entity_type: "course", event_type: "insert", description: "X (copy)", data: { ...data, lessons_copied: { old: null, new: 1 } } }))).toBe("duplicated a course as “X (copy)” (1 lesson)");
    expect(describeRow(row({ entity_type: "course", event_type: "insert", description: "X (copy)", data: { copied_from: data.copied_from } }))).toBe("duplicated a course as “X (copy)”");
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

  it("says a feature switch in plain words: on or off for everyone, and which segment or preview", () => {
    const flag = { entity_type: "feature_flag", description: "chat_dms" };
    expect(describeRow(row({ ...flag, event_type: "update", data: { enabled_globally: { old: false, new: true } } }))).toBe("turned “Chat direct messages” on for everyone");
    expect(describeRow(row({ ...flag, event_type: "update", data: { enabled_globally: { old: true, new: false } } }))).toBe("turned “Chat direct messages” off for everyone");
    // A feature without a friendly name shows its key, spaced out.
    expect(describeRow(row({ entity_type: "feature_flag", description: "some_new_thing", event_type: "update", data: { enabled_globally: { old: false, new: true } } }))).toBe(
      "turned “some new thing” on for everyone",
    );
    expect(describeRow(row({ ...flag, event_type: "insert", data: { enabled_globally: { old: null, new: false } } }))).toBe("added the “Chat direct messages” feature");
    expect(describeRow(row({ ...flag, event_type: "insert", data: { enabled_globally: { old: null, new: true } } }))).toBe("added the “Chat direct messages” feature, on for everyone");
    expect(describeRow(row({ ...flag, event_type: "delete" }))).toBe("removed the “Chat direct messages” feature");
    // Some other column changed: the generic wording, which still says what.
    expect(describeRow(row({ ...flag, event_type: "update", data: { updated_at: { old: "a", new: "b" } } }))).toBe("changed feature “chat_dms” — updated at");

    const link = { entity_type: "feature_flag_segment", description: "chat_dms · Founding Hedgies" };
    expect(describeRow(row({ ...link, event_type: "insert" }))).toBe("gave the “Founding Hedgies” segment the “Chat direct messages” feature");
    expect(describeRow(row({ ...link, event_type: "delete" }))).toBe("took the “Chat direct messages” feature away from the “Founding Hedgies” segment");
    expect(describeRow(row({ entity_type: "feature_flag_segment", description: "chat_dms", event_type: "insert" }))).toBe("gave a segment the “Chat direct messages” feature");
    expect(describeRow(row({ ...link, event_type: "update", data: { x: { old: 1, new: 2 } } }))).toContain("changed feature flag segment");

    const preview = { entity_type: "user_feature_preview", description: "chat_dms" };
    expect(describeRow(row({ ...preview, event_type: "insert" }))).toBe("turned on the “Chat direct messages” preview");
    expect(describeRow(row({ ...preview, event_type: "delete" }))).toBe("turned off the “Chat direct messages” preview");
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

  it("reads the opening of a member's care plan messages as a sentence, and files it under Privacy", () => {
    expect(describeRow(row({ entity_type: "care_dm_read", event_type: "insert", data: {} }))).toBe(
      "opened a member's Hedgie Care plan messages (the messages are not recorded)"
    );
    expect(PRIVACY_ENTITY_TYPES).toContain("care_dm_read");
    // Whatever the member is called (a name with & and <), the sentence is the same and carries no name, no text and no data of its own.
    const odd = describeRow(row({ entity_type: "care_dm_read", event_type: "insert", member_name: "Ada & <Co>", data: { member: { old: null, new: "mbr_AAAAAAAAAAA1" } } }));
    expect(odd).toBe("opened a member's Hedgie Care plan messages (the messages are not recorded)");
    expect(odd).not.toMatch(/Ada|<|&/);
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

describe("date range (a member's Activity tab)", () => {
  const now = new Date("2026-11-17T15:00:00Z"); // Tuesday 17 Nov 2026, 10:00 Eastern
  const parse = (params: Record<string, string>) => parseFeedFilters(params, MEMBER_DEFAULTS, now);

  it("reads ?from= and ?to= as Eastern days and writes them back, whole, in the URL", () => {
    const filters = parse({ from: "2026-11-03", to: "2026-11-10" });
    expect(filters).toMatchObject({ range: { from: "2026-11-03", to: "2026-11-10" }, rangeNotice: null, days: 90 });
    expect(feedSearch(filters, MEMBER_DEFAULTS)).toBe("?from=2026-11-03&to=2026-11-10");
    expect(parseFeedFilters(Object.fromEntries(new URLSearchParams(feedSearch(filters, MEMBER_DEFAULTS))), MEMBER_DEFAULTS, now)).toEqual(filters);
  });

  it("reads ?days=all as all time, and a number the options do not offer as the default", () => {
    expect(parse({ days: "all" }).days).toBe(ALL_TIME_DAYS);
    expect(feedSearch(parse({ days: "all" }), MEMBER_DEFAULTS)).toBe("?days=all");
    expect(parse({ days: "0" }).days).toBe(90);
    expect(parse({ days: "-5" }).days).toBe(90);
  });

  it("lets a custom range win over days, and keeps the other filters in the link", () => {
    const filters = parse({ days: "7", from: "2026-11-03", to: "2026-11-10", noslack: "1" });
    expect(feedSearch(filters, MEMBER_DEFAULTS)).toBe("?noslack=1&from=2026-11-03&to=2026-11-10");
  });

  it("falls back to the default window with a notice for a bad, reversed or future range, never an error", () => {
    for (const params of [{ from: "nope", to: "2026-11-10" }, { from: "2026-11-10", to: "2026-11-03" }, { from: "2026-12-01", to: "2026-12-09" }]) {
      const filters = parse(params);
      expect(filters.range).toBeNull();
      expect(filters.rangeNotice).toEqual(expect.any(String));
      expect(filters.days).toBe(90);
      expect(feedSearch(filters, MEMBER_DEFAULTS)).toBe("");
    }
  });

  it("is not offered by the central log: its URL's from, to and days=all are ignored, and its links never carry them", () => {
    const central = parseFeedFilters({ from: "2026-11-03", to: "2026-11-10", days: "all" });
    expect(central).not.toHaveProperty("range");
    expect(central.days).toBe(7);
    expect(feedSearch({ ...parse({ from: "2026-11-03", to: "2026-11-10" }), days: 30 })).toBe("?view=all&days=30");
    expect(feedSearch({ ...parse({ days: "all" }) })).toBe("?view=all");
  });

  it("covers a custom range from 00:00 Eastern of From to 00:00 Eastern after To", () => {
    const { from, to } = feedWindow(parse({ from: "2026-11-01", to: "2026-11-01" }), now);
    expect(from.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("covers all time from the floor to a minute past now, and a preset as the last n days", () => {
    expect(feedWindow(parse({ days: "all" }), now)).toEqual({ from: new Date("2000-01-01T05:00:00.000Z"), to: new Date("2026-11-17T15:01:00.000Z") });
    expect(feedWindow(parse({ days: "7" }), now)).toEqual({ from: new Date("2026-11-10T15:00:00.000Z"), to: new Date("2026-11-17T15:01:00.000Z") });
  });

  it("says the window and the total in plain words", () => {
    expect(describeFeedWindow(parse({ from: "2026-11-03", to: "2026-11-17" }), 12, now)).toBe("12 events, 3 Nov to 17 Nov");
    expect(describeFeedWindow(parse({}), 1, now)).toBe("1 event, last 90 days");
    expect(describeFeedWindow(parse({ days: "1" }), 0, now)).toBe("0 events, last 24 hours");
    expect(describeFeedWindow(parse({ days: "all" }), 1234, now)).toBe("1,234 events, all time");
  });

  it("sends the range to both the count and the page, whole days in Eastern time", async () => {
    const rpc = vi.fn(async (name: string) => (name === "count_activity_feed" ? { data: 1, error: null } : { data: [row({})], error: null }));
    const filters = { ...parse({ from: "2026-03-08", to: "2026-03-08" }), memberId: "mbr_AAAAAAAAAAA1" };
    await fetchActivityFeed({ rpc } as unknown as SupabaseClient, { ...filters, page: 1, pageSize: 50 }, new Date("2026-04-01T12:00:00Z"));
    const window = { p_from: "2026-03-08T05:00:00.000Z", p_to: "2026-03-09T04:00:00.000Z", p_member_id: "mbr_AAAAAAAAAAA1" };
    expect(rpc).toHaveBeenCalledWith("count_activity_feed", expect.objectContaining(window));
    expect(rpc).toHaveBeenCalledWith("get_activity_feed", expect.objectContaining(window));
  });

  it("keeps a community manager's limits whatever the range: her kinds, no staff filter, no audit or privacy view", async () => {
    const rpc = vi.fn(async (name: string) => (name === "count_activity_feed" ? { data: 1, error: null } : { data: [row({})], error: null }));
    const asked = limitedFeedFilters({ ...parse({ view: "privacy", kinds: "audit", actor: ACTOR, days: "all" }), memberId: "mbr_AAAAAAAAAAA1" });
    expect(asked.days).toBe(ALL_TIME_DAYS);
    await fetchActivityFeed({ rpc } as unknown as SupabaseClient, { ...asked, page: 1, pageSize: 50 }, now, { memberActivityOnly: true });
    expect(rpc).toHaveBeenCalledWith(
      "get_activity_feed",
      expect.objectContaining({ p_kinds: ["activity"], p_entity_types: null, p_actor_user_id: null, p_audit_only: false, p_from: "2000-01-01T05:00:00.000Z" })
    );
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

  it("asks only for the member's activity rows for a community manager, whatever the URL says", async () => {
    const { supabase, rpc } = client(2, [row({})]);
    const asked = query({ view: "privacy", kinds: "audit,session,note", actor: ACTOR });
    await fetchActivityFeed(supabase, { ...asked, memberId: "mbr_AAAAAAAAAAA1" }, now, { memberActivityOnly: true });
    for (const name of ["count_activity_feed", "get_activity_feed"]) {
      expect(rpc).toHaveBeenCalledWith(
        name,
        expect.objectContaining({ p_kinds: ["activity"], p_audit_only: false, p_entity_types: null, p_actor_user_id: null, p_member_id: "mbr_AAAAAAAAAAA1" })
      );
    }
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

describe("a care plan's rows in the Activity Log", () => {
  const OWNER_USER = "00000000-0000-4000-a000-0000000000b1";
  const RECEIVER_USER = "00000000-0000-4000-a000-0000000000b2";
  const plan = (id: string, memberId: string, renewedFrom: string | null) => ({
    id,
    member_id: memberId,
    opened_by: OWNER_USER,
    owned_by: OWNER_USER,
    reason: "check_in",
    channel: "other",
    opened_at: "2027-01-01T17:00:00Z",
    period_ends_on: "2027-01-31",
    renewed_from: renewedFrom,
    closed_at: null,
    ended_how: null,
    last_staff_message_at: null,
    last_member_message_at: null,
    follow_up_on: null,
    handover_to: null,
    handover_by: null,
    handover_at: null,
    next_step: null,
    notes: null,
    deleted_at: null,
    created_at: "2027-01-01T17:00:00Z",
    updated_at: "2027-01-01T17:00:00Z",
  });
  const careRow = (overrides: Partial<ActivityFeedRow>) =>
    row({ entity_type: "care_engagement", entity_id: "care_AAAAAAAAAAA3", member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada Example", ...overrides });

  it("reads each change as what was done, with colleagues by display name and the renewal's number counted along the chain", async () => {
    const data = new InMemoryDataset({
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" },
        { id: "mbr_AAAAAAAAAAA2", name: "Legal Owner", displayName: "Owner & <Co>", userId: OWNER_USER },
        { id: "mbr_AAAAAAAAAAA3", name: "Legal Receiver", displayName: "Rae & <Ceiver>", userId: RECEIVER_USER },
      ],
    });
    data.careEngagements.push(plan("care_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA1", null) as never, plan("care_AAAAAAAAAAA2", "mbr_AAAAAAAAAAA1", "care_AAAAAAAAAAA1") as never, plan("care_AAAAAAAAAAA3", "mbr_AAAAAAAAAAA1", "care_AAAAAAAAAAA2") as never);
    repos = createInMemoryRepos(data);
    const rpc = vi.fn(async () => ({
      data: [
        careRow({ event_id: "audit:1", event_type: "insert", data: { renewed_from: { old: null, new: "care_AAAAAAAAAAA2" }, notes: { old: null, new: "[redacted]" } } }),
        careRow({ event_id: "audit:2", event_type: "update", actor_user_id: OWNER_USER, data: { handover_to: { old: null, new: RECEIVER_USER }, handover_by: { old: null, new: OWNER_USER } } }),
        careRow({ event_id: "audit:3", event_type: "update", actor_user_id: RECEIVER_USER, data: { owned_by: { old: OWNER_USER, new: RECEIVER_USER }, handover_to: { old: RECEIVER_USER, new: null } } }),
        row({ event_id: "audit:4", entity_type: "prickle_type", event_type: "insert", data: {} }),
      ],
      error: null,
    }));

    const rows = await fetchRecordHistory({ rpc } as unknown as SupabaseClient, ["care_engagement"], "care_AAAAAAAAAAA3");

    expect(rows.map(describeRow)).toEqual([
      "renewed the care plan (third plan)",
      "offered the care plan to Rae & <Ceiver>",
      "accepted the care plan from Owner & <Co>",
      "added prickle type",
    ]);
    expect(rows[3].planNumber).toBeUndefined();
  });

  it("leaves a renewal without a number when its chain cannot be read, and reads nothing for a page with no renewal", async () => {
    const data = new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }] });
    repos = createInMemoryRepos(data);
    const spy = vi.spyOn(repos.care, "forMember");
    const rpc = vi.fn(async () => ({ data: [careRow({ event_type: "insert", data: { renewed_from: { old: null, new: "care_GoneGoneGone" } } })], error: null }));
    const [renewed] = await fetchRecordHistory({ rpc } as unknown as SupabaseClient, ["care_engagement"]);
    expect(describeRow(renewed)).toBe("renewed the care plan"); // the chain ends at a plan that is gone: no number rather than a wrong one
    spy.mockClear();
    await fetchRecordHistory({ rpc: async () => ({ data: [careRow({ event_type: "insert", data: { reason: { old: null, new: "check_in" } } })], error: null }) } as unknown as SupabaseClient, ["care_engagement"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads the same through the central feed", async () => {
    const data = new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }] });
    data.careEngagements.push(plan("care_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA1", null) as never, plan("care_AAAAAAAAAAA3", "mbr_AAAAAAAAAAA1", "care_AAAAAAAAAAA1") as never);
    repos = createInMemoryRepos(data);
    const rpc = vi.fn(async (name: string) =>
      name === "count_activity_feed" ? { data: 1, error: null } : { data: [careRow({ event_type: "insert", data: { renewed_from: { old: null, new: "care_AAAAAAAAAAA1" } } })], error: null }
    );
    const feed = await fetchActivityFeed({ rpc } as unknown as SupabaseClient, { ...parseFeedFilters({}), page: 1, pageSize: 50 });
    expect(feed.rows.map(describeRow)).toEqual(["renewed the care plan (second plan)"]);
  });
});

describe("limitedFeedFilters", () => {
  it("drops the audit and privacy views, the type filter and the staff filter, and keeps range, sudo and the hide toggles", () => {
    const asked = { ...parseFeedFilters({ view: "privacy", kinds: "audit,note", actor: ACTOR, sudo: "1", nosystem: "1", noslack: "1", days: "30" }, MEMBER_DEFAULTS), memberId: "mbr_AAAAAAAAAAA1" };
    expect(limitedFeedFilters(asked)).toEqual({ view: "all", kinds: null, actorUserId: null, memberId: "mbr_AAAAAAAAAAA1", sudoOnly: true, hideSystem: true, hideSlack: true, days: 30, range: null, rangeNotice: null });
  });
});

describe("the page builder in the Activity Log", () => {
  const page = (event_type: string, data: ActivityFeedRow["data"], description = "Spring & <Summer> sale") => row({ entity_type: "landing_page", event_type, description, data });
  const template = (event_type: string, data: ActivityFeedRow["data"], description = "Launch & <Kit>") => row({ entity_type: "landing_page_template", event_type, description, data });

  it("says each thing done to a page in plain words, naming the page by its title", () => {
    expect(describeRow(page("insert", { title: { old: null, new: "Spring" } }))).toBe("created the page “Spring & <Summer> sale”");
    expect(describeRow(page("update", { status: { old: "draft", new: "published" }, published_at: { old: null, new: "2026-10-05" } }))).toBe("published the page “Spring & <Summer> sale”");
    expect(describeRow(page("update", { published_at: { old: "2026-10-01", new: "2026-10-05" } }))).toBe("published the page “Spring & <Summer> sale”");
    expect(describeRow(page("update", { status: { old: "published", new: "draft" } }))).toBe("took the page “Spring & <Summer> sale” down");
    expect(describeRow(page("update", { restored_at: { old: null, new: "2026-10-05" } }))).toBe("brought back an earlier version of the page “Spring & <Summer> sale” into its draft");
    expect(describeRow(page("update", { title: { old: "Old & <name>", new: "New" } }))).toBe("renamed the page “Old & <name>” to “New”");
    expect(describeRow(page("update", { slug: { old: "a", new: "b" } }))).toBe("changed the address of the page “Spring & <Summer> sale”");
    expect(describeRow(page("update", { seo_title: { old: "[redacted]", new: "[redacted]" } }))).toBe("changed the search and sharing details of the page “Spring & <Summer> sale”");
    expect(describeRow(page("update", { deleted_at: { old: null, new: "2026-10-05" } }))).toBe("deleted the page “Spring & <Summer> sale”");
    expect(describeRow(page("update", { starter_applied_at: { old: null, new: "2026-10-05" } }))).toBe("replaced the draft of the page “Spring & <Summer> sale” with a starter, a template or an imported file");
    expect(describeRow(page("update", { imported_at: { old: null, new: "2026-10-05" } }))).toBe("imported a Kajabi page into the draft of “Spring & <Summer> sale”");
  });

  it("says the same things about a page of kind template, as the template", () => {
    const kit = (event_type: string, data: ActivityFeedRow["data"]) => row({ entity_type: "landing_page_template", event_type, description: "Launch & <Kit>", data });
    expect(describeRow(kit("insert", { title: { old: null, new: "x" }, kind: { old: null, new: "template" }, draft_data: { old: null, new: "[redacted]" } }))).toBe("created the template “Launch & <Kit>”");
    expect(describeRow(kit("update", { status: { old: "draft", new: "published" } }))).toBe("published the template “Launch & <Kit>”");
    expect(describeRow(kit("update", { published_at: { old: "2026-10-01", new: "2026-10-05" } }))).toBe("published the template “Launch & <Kit>”");
    expect(describeRow(kit("update", { status: { old: "published", new: "draft" } }))).toBe("took the template “Launch & <Kit>” down");
    expect(describeRow(kit("update", { restored_at: { old: null, new: "2026-10-05" } }))).toBe("brought back an earlier version of the template “Launch & <Kit>” into its draft");
    expect(describeRow(kit("update", { starter_applied_at: { old: null, new: "2026-10-05" } }))).toBe("replaced the draft of the template “Launch & <Kit>” with a starter, a template or an imported file");
    expect(describeRow(kit("update", { title: { old: "Old & <name>", new: "New" } }))).toBe("renamed the template “Old & <name>” to “New”");
    expect(describeRow(kit("update", { deleted_at: { old: null, new: "2026-10-05" } }))).toBe("deleted the template “Launch & <Kit>”");
  });

  it("says publishing the site design in plain words, and says nothing of its content", () => {
    const site = (data: ActivityFeedRow["data"]) => row({ entity_type: "landing_site_template", event_type: "update", description: "", data });
    expect(describeRow(site({ published_at: { old: null, new: "2026-10-05" }, published_data: { old: "[redacted]", new: "[redacted]" } }))).toBe("published the site design (the header and footer shared by every website page)");
    expect(describeRow(site({ draft_data: { old: "secret header", new: "secret footer" } }))).not.toMatch(/secret/);
    expect(describeRow(site({ restored_at: { old: null, new: "2026-10-05" }, restored_from_version_id: { old: null, new: "lpstv_AAAAAAAAAAA1" } }))).toBe("brought back an earlier version of the site design into its draft");
    expect(describeRow(site({ draft_reset_at: { old: null, new: "2026-10-05" } }))).toBe("threw away the draft of the site design and went back to the published one");
  });

  it("never repeats a typed search text, description, note or page content, even if the row carried them", () => {
    const sentence = describeRow(row({ entity_type: "landing_page_template", event_type: "update", description: "Launch Kit", data: { seo_title: { old: "secret words", new: "more secret words" }, note: { old: null, new: "secret note" }, draft_data: { old: "secret page", new: "secret page" } } }));
    expect(sentence).not.toMatch(/secret/);
  });
});

describe("who can see a member's profile items in the Activity Log", () => {
  const visibility = (data: ActivityFeedRow["data"], entity_type = "member_profile_visibility", event_type = "update") => row({ entity_type, event_type, data });

  it("names the items whose level changed, never their text, and not the level words", () => {
    expect(describeRow(visibility({ bio_visibility: { old: "community", new: "private" } }))).toBe("changed who can see their bio");
    expect(describeRow(visibility({ photo_visibility: { old: "community", new: "public" }, twitter_visibility: { old: "community", new: "private" } }))).toBe("changed who can see their photo and X link");
    expect(describeRow(visibility({ instagram_visibility: { old: "community", new: "private" }, facebook_visibility: { old: "community", new: "private" }, bio_visibility: { old: "community", new: "private" } }))).toBe(
      "changed who can see their bio, Instagram link and Facebook link"
    );
  });

  it("does not repeat a bio or link that was somehow in the row", () => {
    const sentence = describeRow(visibility({ bio_visibility: { old: "community", new: "private" }, bio: { old: "secret old words", new: "secret new words" }, facebook_url: { old: "https://secret.example", new: "[redacted]" } }));
    expect(sentence).not.toMatch(/secret/);
  });

  it("says it for the topics too", () => {
    expect(describeRow(visibility({ visibility: { old: "community", new: "private" } }, "member_ask_me_about"))).toBe("changed who can see their “Ask me about” topics");
  });
});

describe("a writer profile in the Activity Log", () => {
  const writerProfile = (event_type: string, data: ActivityFeedRow["data"]) => row({ entity_type: "writer_profile", event_type, data });

  it("says the switch, the name, the photo and the bio in plain words, and never the bio itself", () => {
    expect(describeRow(writerProfile("update", { is_public: { old: false, new: true }, published_at: { old: null, new: "2027-03-01" } }))).toBe("turned on their public writer profile");
    expect(describeRow(writerProfile("update", { is_public: { old: true, new: false } }))).toBe("turned off their public writer profile");
    expect(describeRow(writerProfile("update", { public_name_alias_id: { old: null, new: "nalias_AAAAAAAAAAA1" } }))).toBe("changed the name shown on their public writer profile");
    expect(describeRow(writerProfile("update", { show_photo: { old: false, new: true } }))).toBe("changed whether their photo is shown on their public writer profile");
    expect(describeRow(writerProfile("update", { public_bio: { old: "[redacted]", new: "[redacted]" } }))).toBe("changed the bio on their public writer profile");
    expect(describeRow(writerProfile("update", { show_photo: { old: false, new: true }, public_bio: { old: "[redacted]", new: "[redacted]" } }))).toBe("changed whether their photo is shown and the bio on their public writer profile");
  });

  it("does not repeat a bio that was somehow in the row", () => {
    const sentence = describeRow(writerProfile("update", { public_bio: { old: "secret old words", new: "secret new words" } }));
    expect(sentence).not.toMatch(/secret/);
  });

  it("falls back to a plain sentence for any other change", () => {
    expect(describeRow(writerProfile("update", { handle: { old: "a", new: "b" } }))).toMatch(/public writer profile/);
  });
});

describe("the Finisher record in the Activity Log", () => {
  const milestone = (event_type: string, data: ActivityFeedRow["data"], member_name: string | null = "Ada Example") =>
    row({ entity_type: "member_milestone", event_type, data, member_name });

  it("says a proposal, an answer, a change of consent and a take-back in plain words", () => {
    expect(describeRow(milestone("insert", { kind: { old: null, new: "the_end" }, status: { old: null, new: "proposed" } }))).toBe("proposed the \u201cTHE END\u201d milestone for Ada Example");
    expect(describeRow(milestone("update", { status: { old: "proposed", new: "confirmed" }, confirmed_at: { old: null, new: "2026-11-20" } }))).toBe("confirmed a writing milestone");
    expect(describeRow(milestone("update", { status: { old: "proposed", new: "declined" } }))).toBe("said a proposed writing milestone is not theirs, or not yet");
    expect(describeRow(milestone("update", { consent_testimonial: { old: false, new: true } }))).toBe("said we may feature the story of a writing milestone");
    expect(describeRow(milestone("update", { consent_testimonial: { old: true, new: false } }))).toBe("took back permission to feature the story of a writing milestone");
    expect(describeRow(milestone("update", { visibility: { old: "community", new: "private" } }))).toBe("made a writing milestone private");
    expect(describeRow(milestone("update", { visibility: { old: "private", new: "community" } }))).toBe("showed a writing milestone to other members");
    expect(describeRow(milestone("update", { visibility: { old: "community", new: "public" } }))).toBe("showed a writing milestone on their public writer profile");
    expect(describeRow(milestone("update", { deleted_at: { old: null, new: "2026-11-20" } }, "Ada & <Bo>"))).toBe("took back a proposed milestone for Ada & <Bo>");
  });

  it("says a milestone the member added themselves, and their own take-back, without a date or a story", () => {
    const own = describeRow(milestone("insert", { kind: { old: null, new: "publish_ready" }, source: { old: null, new: "member" }, status: { old: null, new: "confirmed" }, story_after: { old: null, new: "[redacted]" } }));
    expect(own).toBe(`added the \u201c${MILESTONE_LABELS.publish_ready}\u201d milestone`);
    expect(own).not.toMatch(/proposed|redacted/);
    expect(describeRow({ ...milestone("update", { deleted_at: { old: null, new: "2026-11-20" } }), actor_kind: "member" })).toBe("took back a milestone they added");
  });

  it("says the answer to the question asked when a project moved forward, yes or not yet", () => {
    const yes = describeRow(milestone("insert", { kind: { old: null, new: "the_end" }, source: { old: null, new: "project_stage" }, status: { old: null, new: "confirmed" } }));
    expect(yes).toBe(`added the “${MILESTONE_LABELS.the_end}” milestone when a project moved forward`);
    const notYet = describeRow(milestone("insert", { kind: { old: null, new: "publish_ready" }, source: { old: null, new: "project_stage" }, status: { old: null, new: "declined" } }));
    expect(notYet).toBe(`said “not yet” to the “${MILESTONE_LABELS.publish_ready}” milestone when a project moved forward`);
    expect(`${yes} ${notYet}`).not.toMatch(/proposed/);
  });

  it("never repeats a story or a date the member wrote", () => {
    const sentence = describeRow(milestone("update", { status: { old: "proposed", new: "confirmed" }, story_after: { old: "[redacted]", new: "[redacted]" }, achieved_on: { old: null, new: "2026-05-01" } }));
    expect(sentence).toBe("confirmed a writing milestone");
    expect(sentence).not.toMatch(/redacted|2026/);
  });
});
