import { describe, it, expect } from "vitest";
import { KAJABI_ADMIN_OFFER_URL } from "@/lib/config";
import { buildOfferCoverage, coverageState, loadOfferCoverage, offerDetailOf } from "@/lib/offer-coverage";

const offers = [
  {
    kajabi_offer_id: "o1",
    name: "Summer Retreat",
    status: "active",
    data: { attributes: { checkout_url: "https://example.com/offers/abc" }, relationships: { site: { data: { id: "site1" } } } },
  },
  { kajabi_offer_id: "o2", name: "Ready Writer", status: "active" },
  { kajabi_offer_id: "o3", name: "180 Program", status: "active" },
  { kajabi_offer_id: "o4", name: "Orphan Offer", status: null },
  { kajabi_offer_id: "o5", name: null, status: null },
];

describe("buildOfferCoverage", () => {
  const rows = buildOfferCoverage({
    offers,
    eventLinks: [{ kajabi_offer_id: "o1", event: { slug: "retreat", title: "Retreat" } }],
    courseLinks: [
      { offerId: "o2", course: { id: "c1", title: "Ready Writer" } },
      { offerId: "o1", course: { id: "c2", title: "Retreat Course" } },
    ],
    programs: [{ id: "p1", name: "180", kajabi_offer_names: ["180 Program"] }],
  });
  const byId = (id: string) => rows.find((r) => r.offerId === id)!;

  it("maps each source to its admin page", () => {
    expect(byId("o2").resources).toEqual([{ kind: "course", title: "Ready Writer", href: "/admin/courses/c1" }]);
    expect(byId("o3").resources).toEqual([{ kind: "program", title: "180", href: "/admin/programs/p1" }]);
    expect(byId("o1").resources.map((r) => r.kind)).toEqual(["event", "course"]);
  });

  it("flags unmapped and multiply mapped offers, and puts them first", () => {
    expect(coverageState(byId("o4"))).toBe("unmapped");
    expect(coverageState(byId("o1"))).toBe("multiple");
    expect(coverageState(byId("o2"))).toBe("mapped");
    expect(rows[0].offerId).toBe("o1");
    expect(rows.map((r) => coverageState(r))).toEqual(["multiple", "unmapped", "unmapped", "mapped", "mapped"]);
    expect(rows.at(-1)!.offerId).toBe("o2");
  });

  it("links every offer to its page in the Kajabi admin, and to its checkout page when the record has one", () => {
    expect(byId("o1").kajabiUrl).toBe(KAJABI_ADMIN_OFFER_URL.replace("{offerId}", "o1"));
    expect(byId("o1").checkoutUrl).toBe("https://example.com/offers/abc");
    expect(byId("o2").kajabiUrl).toBe(KAJABI_ADMIN_OFFER_URL.replace("{offerId}", "o2"));
    expect(byId("o2").checkoutUrl).toBeNull();
  });

  it("falls back to the id for an offer without a name and never matches it to a program", () => {
    expect(byId("o5").name).toBe("o5");
    expect(byId("o5").resources).toEqual([]);
  });
});

describe("loadOfferCoverage", () => {
  it("joins the repositories and drops links to resources that are gone", async () => {
    const repos = {
      billing: { kajabiOfferRows: async () => offers },
      events: {
        linkedOffers: async () => [
          { kajabi_offer_id: "o1", event_id: "e1" },
          { kajabi_offer_id: "o4", event_id: "gone" },
        ],
        listWithPhotoCounts: async () => [{ id: "e1", slug: "retreat", title: "Retreat" }],
      },
      courses: { courses: async () => [{ id: "c1", source_key: "k1", title: "Ready Writer" }, { id: "c9", source_key: null, title: "Hub only" }] },
      kajabiCourses: {
        liveOffers: async (ids: string[]) => {
          expect(ids).toEqual(["k1"]);
          return [
            { course_kajabi_id: "k1", offer_kajabi_id: "o2" },
            { course_kajabi_id: "other", offer_kajabi_id: "o3" },
          ];
        },
      },
      programs: { listWithCounts: async () => [] },
    } as never;
    const rows = await loadOfferCoverage(repos);
    const byId = (id: string) => rows.find((r) => r.offerId === id)!;
    expect(byId("o1").resources).toHaveLength(1);
    expect(byId("o2").resources[0].href).toBe("/admin/courses/c1");
    expect(byId("o3").resources).toEqual([]);
    expect(byId("o4").resources).toEqual([]);
  });
});

describe("offerDetailOf", () => {
  it("joins the internal title, the price and the id", () => {
    const data = { attributes: { internal_title: "PAY IN FULL for 2024", price_description: "$25.00 USD" } };
    expect(offerDetailOf("42", "4 Month Payment Plan", data)).toBe("PAY IN FULL for 2024 · $25.00 USD · #42");
  });

  it("leaves out an internal title that repeats the name, and copes with a record without attributes", () => {
    expect(offerDetailOf("42", "Same", { attributes: { internal_title: " Same " } })).toBe("#42");
    expect(offerDetailOf("42", null, null)).toBe("#42");
  });
});

describe("the Kajabi admin link", () => {
  it("is the offer's edit page by its id alone", () => {
    expect(KAJABI_ADMIN_OFFER_URL).toBe("https://app.kajabi.com/admin/offers/{offerId}/edit");
  });
});
