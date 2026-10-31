import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";

// The admin event page lists attendees by display name, with the legal name beside it when it differs.

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: {} }),
}));
const repos = createInMemoryRepos(
  new InMemoryDataset({
    ...eventSeed([{ id: "evt_AAAAAAAAAAA1", title: "Open house", slug: "open-house" }]),
    members: [
      { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", email: "ada@example.com" },
      { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", displayName: null, email: "bo@example.com" },
    ],
    eventAttendees: [
      { id: "a1", event_id: "evt_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", created_at: "2097-01-01T00:00:00Z", created_by: null },
      { id: "a2", event_id: "evt_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA2", created_at: "2097-01-02T00:00:00Z", created_by: null },
    ],
  }),
);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
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
