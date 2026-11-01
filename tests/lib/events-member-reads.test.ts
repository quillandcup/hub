import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseEventRepository } from "@/lib/data/events";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import { parseUniversal } from "@/lib/search/syntax";

let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import { universalSearch } from "@/lib/search/universal";

// A failed query is an error, never an empty result.
describe("SupabaseEventRepository on a database error", () => {
  const failing = () => new SupabaseEventRepository(createFakeSupabase({ community_event_details: { error: { message: "boom" } }, community_events: { error: { message: "boom" } }, event_photos: { error: { message: "boom" } }, event_attendees: { error: { message: "boom" } } }) as never);

  it("throws from every member read", async () => {
    await expect(failing().listWithCover()).rejects.toThrow("boom");
    await expect(failing().visibleBySlug("x")).rejects.toThrow("boom");
    await expect(failing().visiblePhotos("x")).rejects.toThrow("boom");
    await expect(failing().isVisible("x")).rejects.toThrow("boom");
    await expect(failing().visibleEndingFrom(["x"], "2097-01-01")).rejects.toThrow("boom");
    await expect(failing().search({ words: ["a"], limit: 5, offset: 0 })).rejects.toThrow("boom");
    await expect(failing().search({ words: ["a"], attendedBy: ["mbr_AAAAAAAAAAA1"], limit: 5, offset: 0 })).rejects.toThrow("boom");
  });
});

describe("universal search over events", () => {
  const ctx = (extra: object = {}) => ({
    supabase: createFakeSupabase({ member_directory: { data: [{ id: "mbr_AAAAAAAAAAA1" }] } }) as unknown as SupabaseClient,
    viewerMemberId: "mbr_AAAAAAAAAAA1",
    isActingAsAdmin: false,
    chatChannels: [],
    limit: 1,
    ...extra,
  });
  const seed = () => {
    dataset = new InMemoryDataset({
      ...eventSeed([
        { id: "evnt_AAAAAAAAAAA1", slug: "lakeside-retreat", title: "Lakeside Retreat", starts_at: "2097-04-01", ends_at: "2097-04-03", location: "Asheville" },
        { id: "evnt_AAAAAAAAAAA2", slug: "lakeside-workshop", title: "Lakeside Workshop", starts_at: "2097-03-01", ends_at: "2097-03-01", speakers: "Ada Example" },
        { id: "evnt_AAAAAAAAAAA3", slug: "lakeside-hidden", title: "Lakeside Hidden", starts_at: "2097-02-01", ends_at: "2097-02-01", deleted_at: "2097-01-01T00:00:00Z" },
      ]),
      eventAttendees: [{ event_id: "evnt_AAAAAAAAAAA2", member_id: "mbr_AAAAAAAAAAA1" }],
    });
  };

  it("pages newest first, linking members to the slug and flagging when there is more", async () => {
    seed();

    const [events] = await universalSearch(ctx(), parseUniversal("in:events lakeside"));

    expect(events.hasMore).toBe(true);
    expect(events.hits).toMatchObject([{ id: "evnt_AAAAAAAAAAA1", title: "Lakeside Retreat", subtitle: "Asheville", href: "/events/lakeside-retreat" }]);
  });

  it("lets an admin see hidden events and links them by id", async () => {
    seed();

    const [events] = await universalSearch(ctx({ isActingAsAdmin: true, limit: 10 }), parseUniversal("in:events lakeside"));

    expect(events.hits.map((h) => h.href)).toEqual(["/admin/events/evnt_AAAAAAAAAAA1", "/admin/events/evnt_AAAAAAAAAAA2", "/admin/events/evnt_AAAAAAAAAAA3"]);
  });

  it("narrows to events a named member attended, and to nothing when none match", async () => {
    seed();

    const [attended] = await universalSearch(ctx({ limit: 10 }), parseUniversal("in:events lakeside from:me"));
    const nobodyNamed = { supabase: createFakeSupabase({ member_directory: { data: [] } }) as unknown as SupabaseClient, limit: 10 };
    const [none] = await universalSearch(ctx(nobodyNamed), parseUniversal("in:events lakeside from:nobody"));
    const [noViewer] = await universalSearch(ctx({ viewerMemberId: null, limit: 10 }), parseUniversal("in:events from:me"));

    expect(attended.hits.map((h) => h.title)).toEqual(["Lakeside Workshop with Ada Example"]);
    expect(none.hits).toEqual([]);
    expect(noViewer.hits).toEqual([]);
  });
});
