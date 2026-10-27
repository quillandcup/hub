import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The admin event page lists attendees by display name, with the legal name beside it when it differs.

const tables: Record<string, unknown> = {
  events: { id: "evt_AAAAAAAAAAA1", title: "Open house", calendar_event_id: null },
  event_photos: [],
  event_attendees: [
    { id: "a1", member_id: "mbr_AAAAAAAAAAA1", members: { name: "Ada Example", display_name: "Ada E", email: "ada@example.com" } },
    { id: "a2", member_id: "mbr_AAAAAAAAAAA2", members: { name: "Bo Example", display_name: null, email: "bo@example.com" } },
  ],
};
const chain = (table: string) => {
  const result = { data: tables[table], error: null };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    order: () => q,
    single: async () => result,
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return q;
};
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: { from: (t: string) => chain(t) } }),
}));
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({ badges: { typeForEvent: async () => null }, prickles: { byCalendarEventIds: async () => [] } }),
}));

import { GET } from "@/app/api/admin/events/[id]/route";

describe("GET /api/admin/events/[id] attendees", () => {
  it("names attendees by display name and keeps the legal name only when it differs", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/events/evt_AAAAAAAAAAA1"), { params: Promise.resolve({ id: "evt_AAAAAAAAAAA1" }) });
    const body = await res.json();
    expect(body.attendees[0]).toMatchObject({ memberName: "Ada E", memberRealName: "Ada Example" });
    expect(body.attendees[1].memberName).toBe("Bo Example");
    expect(body.attendees[1].memberRealName).toBeUndefined();
  });
});
