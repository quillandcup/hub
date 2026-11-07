import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityFeedRow } from "@/lib/activity-feed";
import { detailLines } from "@/lib/audit-details";
import { referencedIds, withReferenceNames } from "@/lib/audit-references";

const USER = "00000000-0000-4000-8000-000000000001";
const byIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, name: "Ada Legal", displayName: "Ada Example" })));
const prickleByIds = vi.fn(async (ids: string[]) =>
  ids.map((id) => ({ id, title: null, startTime: "2097-03-02T15:00:00Z", type: { id: "prty_AAAAAAAAAAA1", name: "Sprint" } }))
);
const eventByIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, slug: "open-house", title: "Open House" })));
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    members: { byIds, idsByUserId: async () => new Map([[USER, "mbr_AAAAAAAAAAA1"]]) },
    events: { byIds: eventByIds },
    prickles: { byIds: prickleByIds, types: async () => [{ id: "prty_AAAAAAAAAAA1", name: "Sprint" }] },
  }),
}));

const row = (changes: Record<string, unknown>): ActivityFeedRow => ({
  event_id: "e1",
  kind: "audit",
  occurred_at: "2097-01-01T10:00:00Z",
  is_audit: true,
  actor_user_id: null,
  actor_kind: "staff",
  actor_label: "Admin",
  member_id: null,
  member_name: null,
  acting_as_member_id: null,
  acting_as_member_name: null,
  event_type: "insert",
  entity_type: "calendar_feed_item",
  entity_id: null,
  title: null,
  description: null,
  source: null,
  data: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { old: null, new: v }])),
});

describe("audit references", () => {
  const base = row({
    id: "cfi_AAAAAAAAAAA1",
    created_by: USER,
    member_id: "mbr_AAAAAAAAAAA1",
    prickle_id: "prkl_AAAAAAAAAAA1",
    type_id: "prty_AAAAAAAAAAA1",
    event_id: "evt_AAAAAAAAAAA1",
    note: "hello",
  });

  it("collects every id once", () => {
    expect(referencedIds([base, base]).sort()).toEqual([USER, "evt_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA1", "prty_AAAAAAAAAAA1"]);
  });

  it("replaces ids with names, links only member and prickle pages, and drops the row id and unresolved ids", async () => {
    const [resolved] = await withReferenceNames({} as SupabaseClient, [base]);
    const lines = detailLines(resolved);
    const by = Object.fromEntries(lines.map((l) => [l.field, l.new]));
    expect(by.id).toBeUndefined();
    expect(by.event_id).toEqual({ text: "Open House", href: "/admin/events/open-house" });
    expect(by.created_by).toEqual({ text: "Ada Example", href: "/admin/members/mbr_AAAAAAAAAAA1" });
    expect(by.member_id?.text).toBe("Ada Example");
    expect(by.prickle_id?.href).toBe("/admin/prickles/prkl_AAAAAAAAAAA1");
    expect(by.prickle_id?.text).toContain("Sprint");
    expect(by.type_id).toEqual({ text: "Sprint" });
    expect(by.note).toEqual({ text: "hello" });
    expect(lines.find((l) => l.field === "created_by")?.label).toBe("added by");
  });

  it("hides empty values on an insert and shows timestamps as dates", () => {
    const lines = detailLines(row({ timezone: null, enabled_at: "2026-11-03T13:36:16.84066+00:00" }));
    expect(lines.map((l) => l.field)).toEqual(["enabled_at"]);
    expect(lines[0].new?.text).not.toContain("T13:36");
  });

  it("does no lookups when no row references anything", async () => {
    const plain = row({ note: "x" });
    expect(await withReferenceNames({} as SupabaseClient, [plain])).toEqual([plain]);
  });
});
