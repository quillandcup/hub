import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";

// The admin event page shows an attendee who bought a ticket in Kajabi as Purchased, derived from the
// linked offers' purchases (not stored on the attendee).

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: {} }),
}));
const repos = createInMemoryRepos(
  new InMemoryDataset({
    ...eventSeed([{ id: "evt_AAAAAAAAAAA1", title: "Retreat", slug: "retreat" }]),
    members: [
      { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com" },
      { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.com" },
    ],
    kajabiOffers: [{ kajabi_offer_id: "o1", name: "Retreat" }],
    kajabiCustomers: [{ kajabi_customer_id: "c1", email: "ada@example.com" }],
    kajabiPurchases: [{ kajabi_purchase_id: "p1", kajabi_customer_id: "c1", kajabi_offer_id: "o1", amount_in_cents: 5000, deactivated_at: null }],
    eventOffers: [{ event_id: "evt_AAAAAAAAAAA1", kajabi_offer_id: "o1" }],
    eventAttendees: [
      { id: "a1", event_id: "evt_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", created_at: "2097-01-01T00:00:00Z", ticket_source: null },
      { id: "a2", event_id: "evt_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA2", created_at: "2097-01-02T00:00:00Z", ticket_source: "comped" },
    ],
  } as never),
);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { GET } from "@/app/api/admin/events/[id]/route";

describe("GET /api/admin/events/[id] attendees", () => {
  it("marks the attendees who hold a Kajabi purchase, and leaves the recorded source as it was", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/events/evt_AAAAAAAAAAA1"), { params: Promise.resolve({ id: "evt_AAAAAAAAAAA1" }) });
    const body = await res.json();

    expect(body.attendees.map((a: { memberName: string; purchasedInKajabi: boolean; ticketSource: string | null }) => [a.memberName, a.purchasedInKajabi, a.ticketSource])).toEqual([
      ["Ada Example", true, null],
      ["Bo Example", false, "comped"],
    ]);
  });
});
