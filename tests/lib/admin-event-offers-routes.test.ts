import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";

// The routes that link Kajabi offers to an event and list its buyers, over the in-memory repositories.

const auth = vi.hoisted(() => ({ current: { user: { id: "admin" }, supabase: {} } as { user: { id: string } | null; forbidden?: boolean; supabase: object } }));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => auth.current }));

const state = vi.hoisted(() => ({ repos: null as unknown, kajabi: null as null | { fetchContactWithAttachments: (id: string) => Promise<unknown> } }));
vi.mock("@/lib/kajabi/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/kajabi/client")>("@/lib/kajabi/client")),
  createKajabiClient: () => {
    if (!state.kajabi) throw new Error("Kajabi is not configured");
    return state.kajabi;
  },
}));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => state.repos,
}));

import { GET as listOffers, POST as linkOffer } from "@/app/api/admin/events/[id]/offers/route";
import { DELETE as unlinkOffer } from "@/app/api/admin/events/[id]/offers/[offerId]/route";
import { GET as findMatches } from "@/app/api/admin/events/[id]/kajabi-matches/route";

const A = "evt_AAAAAAAAAAA1";
const B = "evt_AAAAAAAAAAA2";

function reset() {
  state.kajabi = null;
  auth.current = { user: { id: "admin" }, supabase: {} };
  state.repos = createInMemoryRepos(
    new InMemoryDataset({
      ...eventSeed([
        { id: A, title: "Summer Retreat", slug: "summer" },
        { id: B, title: "Winter Retreat", slug: "winter" },
      ]),
      members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com" }],
      kajabiOffers: [
        { kajabi_offer_id: "o1", name: "Summer Retreat" },
        { kajabi_offer_id: "o2", name: "Winter Retreat" },
        { kajabi_offer_id: "o3", name: "Autumn Retreat" },
      ],
      kajabiCustomers: [{ kajabi_customer_id: "c1", email: "ada@example.com" }],
      kajabiPurchases: [{ kajabi_purchase_id: "p1", kajabi_customer_id: "c1", kajabi_offer_id: "o1", amount_in_cents: 5000, deactivated_at: null }],
      eventOffers: [{ event_id: B, kajabi_offer_id: "o2" }],
    } as never),
  );
}

const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${path}`, init);
const post = (id: string, body: unknown) =>
  linkOffer(req(`/api/admin/events/${id}/offers`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(reset);

describe("event offers routes", () => {
  it("lists the offers linked to the event and the ones still free to link", async () => {
    await post(A, { kajabiOfferId: "o1" });

    const body = await (await listOffers(req(`/api/admin/events/${A}/offers`), { params: Promise.resolve({ id: A }) })).json();

    expect(body.linked.map((o: { name: string }) => o.name)).toEqual(["Summer Retreat"]);
    // Winter sells the other event, so it is not offered.
    expect(body.available.map((o: { name: string }) => o.name)).toEqual(["Autumn Retreat"]);
  });

  it("links an offer, then refuses one that sells another event", async () => {
    expect((await post(A, { kajabiOfferId: "o1" })).status).toBe(201);

    const taken = await post(A, { kajabiOfferId: "o2" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ eventId: B });
  });

  it("answers a bad request, a missing event and a missing offer", async () => {
    expect((await post(A, "not json")).status).toBe(400);
    expect((await post(A, {})).status).toBe(400);
    expect((await post("evt_AAAAAAAAAAA9", { kajabiOfferId: "o1" })).status).toBe(404);
    expect((await post(A, { kajabiOfferId: "nope" })).status).toBe(404);
  });

  it("unlinks an offer and says so when it was not linked", async () => {
    const call = (id: string, offerId: string) => unlinkOffer(req(`/api/admin/events/${id}/offers/${offerId}`, { method: "DELETE" }), { params: Promise.resolve({ id, offerId }) });

    expect((await call(B, "o2")).status).toBe(200);
    expect((await call(B, "o2")).status).toBe(404);
  });

  it("finds the buyers of the linked offers", async () => {
    await post(A, { kajabiOfferId: "o1" });

    const res = await findMatches(req(`/api/admin/events/${A}/kajabi-matches`), { params: Promise.resolve({ id: A }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.offersLinked).toBe(true);
    expect(body.buyers.map((b: { member_name: string }) => b.member_name)).toEqual(["Ada Example"]);
  });

  it("asks Kajabi about attendees with no purchase when it is configured, and carries on when it is not", async () => {
    const dataset = new InMemoryDataset({
      ...eventSeed([{ id: A, title: "Summer Retreat", slug: "summer" }]),
      members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com", kajabiId: "k1" }],
      kajabiOffers: [{ kajabi_offer_id: "o1", name: "Summer Retreat" }],
      eventOffers: [{ event_id: A, kajabi_offer_id: "o1" }],
      eventAttendees: [{ id: "a1", event_id: A, member_id: "mbr_AAAAAAAAAAA1", ticket_source: null }],
    } as never);
    state.repos = createInMemoryRepos(dataset);
    const search = async () => (await (await findMatches(req(`/api/admin/events/${A}/kajabi-matches`), { params: Promise.resolve({ id: A }) })).json()).attendeesWithoutTicket[0].kajabi_offer;

    expect(await search()).toBe("unknown");

    const asked: string[] = [];
    state.kajabi = {
      fetchContactWithAttachments: async (id) => {
        asked.push(id);
        return { id, type: "contacts", attributes: {}, relationships: { offers: { data: [{ id: "o1", type: "offers" }] } } };
      },
    };
    expect(await search()).toBe("held");
    expect(asked).toEqual(["k1"]);
  });

  it("404s matches for an event that does not exist", async () => {
    const res = await findMatches(req("/api/admin/events/evt_AAAAAAAAAAA9/kajabi-matches"), { params: Promise.resolve({ id: "evt_AAAAAAAAAAA9" }) });
    expect(res.status).toBe(404);
  });

  it("turns away anyone who is not an admin", async () => {
    auth.current = { user: null, supabase: {} };
    expect((await post(A, { kajabiOfferId: "o1" })).status).toBe(401);
    auth.current = { user: { id: "member" }, forbidden: true, supabase: {} };
    expect((await post(A, { kajabiOfferId: "o1" })).status).toBe(403);
    expect((await findMatches(req(`/api/admin/events/${A}/kajabi-matches`), { params: Promise.resolve({ id: A }) })).status).toBe(403);
  });
});
