import { describe, expect, it } from "vitest";
import { describeRow, type ActivityFeedRow } from "@/lib/activity-feed";

function roleRow(overrides: Partial<ActivityFeedRow>): ActivityFeedRow {
  return {
    event_id: "audit:7",
    kind: "audit",
    occurred_at: "2026-10-05T12:00:00Z",
    is_audit: true,
    actor_user_id: "00000000-0000-4000-a000-0000000000a1",
    actor_kind: "staff",
    actor_label: "Bramble Admin",
    member_id: null,
    member_name: null,
    acting_as_member_id: null,
    acting_as_member_name: null,
    event_type: "insert",
    entity_type: "user_role",
    entity_id: "urol_AAAAAAAAAAA1",
    title: null,
    description: "ada@example.test",
    source: "audit_log",
    data: { role: { old: null, new: "community_manager" }, user_id: { old: null, new: "00000000-0000-4000-a000-0000000000b1" } },
    ...overrides,
  };
}

describe("the Activity Log sentence for a staff role", () => {
  it("says who was given which role, by the role's name", () => {
    expect(describeRow(roleRow({}))).toBe("gave ada@example.test the role Community Manager");
    expect(describeRow(roleRow({ data: { role: { old: null, new: "conversion_specialist" } } }))).toBe("gave ada@example.test the role Conversion Specialist");
  });

  it("says who lost which role", () => {
    const removed = roleRow({ event_type: "delete", data: { role: { old: "assistant", new: null } } });
    expect(describeRow(removed)).toBe("took the role Assistant away from ada@example.test");
  });

  it("reads a name with & and < as plain text and never carries anything typed", () => {
    const text = describeRow(roleRow({ description: "a&b<c>@example.test" }));
    expect(text).toBe("gave a&b<c>@example.test the role Community Manager");
  });

  it("still reads when the account or the role is not known", () => {
    expect(describeRow(roleRow({ description: null, data: { role: { old: null, new: "superuser" } } }))).toBe("gave a user the role a role");
  });
});
