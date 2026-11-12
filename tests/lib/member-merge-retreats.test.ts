import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed } from "@/tests/helpers/event-fixtures";

// Merging a duplicate into a member must not drop their retreats, badges and Big Sister records:
// those rows cascade on delete, so the merge has to move them first.

const state = vi.hoisted(() => ({ repos: null as unknown }));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => ({ user: { id: "admin" }, supabase: {} }) }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => state.repos,
}));

import { POST } from "@/app/api/admin/members/merge/route";

const KEEP = "mbr_AAAAAAAAAAA1";
const DUP = "mbr_AAAAAAAAAAA2";
const OTHER = "mbr_AAAAAAAAAAA3";
const SPRING = "evt_AAAAAAAAAAA1";
const ARKANSAS = "evt_AAAAAAAAAAA2";
const TYPE = "badge_AAAAAAAAAAA1";

let dataset: InMemoryDataset;

beforeEach(() => {
  dataset = new InMemoryDataset({
    ...eventSeed([
      { id: SPRING, title: "Spring retreat", slug: "spring" },
      { id: ARKANSAS, title: "Arkansas retreat", slug: "arkansas" },
    ]),
    members: [
      { id: KEEP, name: "Ada Example", email: "ada@example.com" },
      { id: DUP, name: "Ada E", email: "ada.old@example.com", status: "lead" },
      { id: OTHER, name: "Other Member", email: "other@example.com" },
    ],
    eventAttendees: [
      { id: "a1", event_id: SPRING, member_id: DUP, ticket_source: "gifted" },
      { id: "a2", event_id: ARKANSAS, member_id: DUP },
      { id: "a3", event_id: ARKANSAS, member_id: KEEP },
    ],
    memberBadges: [
      { id: "b1", memberId: DUP, badgeTypeId: TYPE, occurredAt: "2023-04-01", note: null, eventId: SPRING, awardedBy: null },
      { id: "b2", memberId: DUP, badgeTypeId: TYPE, occurredAt: "2025-04-29", note: null, eventId: ARKANSAS, awardedBy: null },
      { id: "b3", memberId: KEEP, badgeTypeId: TYPE, occurredAt: "2025-04-29", note: null, eventId: ARKANSAS, awardedBy: null },
    ],
    mentorships: [
      { id: "m1", mentor_member_id: DUP, new_member_id: OTHER, started_on: "2023-08-11", status: "matched", kind: "direct" },
      { id: "m2", mentor_member_id: OTHER, new_member_id: DUP, started_on: "2023-12-11", status: "matched", kind: "trial" },
    ],
    bigSisterVolunteers: [{ member_id: DUP, note: "Happy to help", created_at: "2023-01-01T00:00:00Z", updated_at: "2023-01-01T00:00:00Z", deleted_at: null }],
  } as never);
  state.repos = createInMemoryRepos(dataset);
});

const merge = () =>
  POST(new NextRequest("http://localhost/api/admin/members/merge", { method: "POST", body: JSON.stringify({ primaryId: KEEP, secondaryId: DUP }) }));

describe("POST /api/admin/members/merge keeps retreats, badges and Big Sister records", () => {
  it("moves the duplicate's event attendance and badges to the kept member, without doubling one they already have", async () => {
    const res = await merge();
    expect(res.status).toBe(200);

    const attendeesOfKeep = dataset.eventAttendees.filter((a) => a.member_id === KEEP);
    expect(attendeesOfKeep.map((a) => a.event_id).sort()).toEqual([SPRING, ARKANSAS]);
    expect(attendeesOfKeep.find((a) => a.event_id === SPRING)?.ticket_source).toBe("gifted");
    expect(dataset.memberBadges.filter((b) => b.memberId === KEEP).map((b) => b.eventId).sort()).toEqual([SPRING, ARKANSAS]);
  });

  it("moves the duplicate's Big Sister matches and volunteer record", async () => {
    await merge();

    expect(dataset.mentorships.map((m) => [m.id, m.mentor_member_id, m.new_member_id])).toEqual([
      ["m1", KEEP, OTHER],
      ["m2", OTHER, KEEP],
    ]);
    expect(dataset.bigSisterVolunteers.map((v) => v.member_id)).toEqual([KEEP]);
  });
});
