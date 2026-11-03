import { describe, expect, it } from "vitest";
import { activityLink } from "@/lib/activity-links";

const base = { kind: "activity" as const, source: null as string | null, entity_type: null as string | null, entity_id: null as string | null, member_id: "mbr_AAAAAAAAAAA1" as string | null };

describe("activityLink", () => {
  it("opens the prickle of a check-in or attendance", () => {
    expect(activityLink({ ...base, source: "prickle_checkins", entity_type: "prickle", entity_id: "prkl_AAAAAAAAAAA1" })).toEqual({ href: "/admin/prickles/prkl_AAAAAAAAAAA1", label: "Open the prickle" });
  });

  it("opens the member an audited change was to", () => {
    expect(activityLink({ ...base, kind: "audit", entity_type: "member", entity_id: "mbr_AAAAAAAAAAA2" })).toEqual({ href: "/admin/members/mbr_AAAAAAAAAAA2", label: "Open the member" });
  });

  it("sends a feedback submission to that member's feedback, never to one item (a feedback id is not a readable id)", () => {
    expect(activityLink({ ...base, source: "feedback", entity_type: "feedback", entity_id: "b9f3a6c2-0000-4000-8000-000000000001" })).toEqual({
      href: "/admin/feedback?member=mbr_AAAAAAAAAAA1",
      label: "See their feedback",
    });
  });

  it("offers nothing for a row with no page, or an id that isn't a readable one", () => {
    expect(activityLink({ ...base, source: "slack" })).toBeNull();
    expect(activityLink({ ...base, entity_type: "prickle", entity_id: "not-a-prickle-id" })).toBeNull();
    expect(activityLink({ ...base, entity_type: "prickle", entity_id: null })).toBeNull();
    expect(activityLink({ ...base, kind: "audit", entity_type: "member", entity_id: "9b2c7c2e-1111-4000-8000-000000000002" })).toBeNull();
    expect(activityLink({ ...base, source: "feedback", member_id: null })).toBeNull();
    expect(activityLink({ ...base, kind: "session", source: "feedback" })).toBeNull();
  });
});
