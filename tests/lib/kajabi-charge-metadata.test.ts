import { describe, expect, it } from "vitest";
import { countUnrecognisedKajabiMetadata, hasKajabiMetadata, kajabiOfferIdOf } from "@/lib/kajabi-charge-metadata";

describe("kajabiOfferIdOf", () => {
  it("reads kjb_offer_id", () => {
    expect(kajabiOfferIdOf({ metadata: { kjb_offer_id: "o1" } })).toBe("o1");
  });

  it("falls back to platform_product_ID, and prefers kjb_offer_id when both are there", () => {
    expect(kajabiOfferIdOf({ metadata: { platform_product_ID: "o2", platform_order_ID: "ord" } })).toBe("o2");
    expect(kajabiOfferIdOf({ metadata: { kjb_offer_id: "o1", platform_product_ID: "o2" } })).toBe("o1");
    expect(kajabiOfferIdOf({ metadata: { kjb_offer_id: 7, platform_product_ID: "o2" } })).toBe("o2");
  });

  it("never reads platform_order_ID, and returns null for neither key or non-string values", () => {
    expect(kajabiOfferIdOf({ metadata: { platform_order_ID: "ord" } })).toBeNull();
    expect(kajabiOfferIdOf({ metadata: { kjb_offer_id: 5, platform_product_ID: null } })).toBeNull();
    expect(kajabiOfferIdOf({ metadata: {} })).toBeNull();
    expect(kajabiOfferIdOf({ metadata: [] })).toBeNull();
    expect(kajabiOfferIdOf({})).toBeNull();
    expect(kajabiOfferIdOf(null)).toBeNull();
    expect(kajabiOfferIdOf("text")).toBeNull();
  });
});

describe("unrecognised Kajabi metadata", () => {
  it("sees Kajabi keys by prefix", () => {
    expect(hasKajabiMetadata({ metadata: { kjb_order_checkout_id: "x" } })).toBe(true);
    expect(hasKajabiMetadata({ metadata: { platform_product_name: "x" } })).toBe(true);
    expect(hasKajabiMetadata({ metadata: { order_id: "x" } })).toBe(false);
    expect(hasKajabiMetadata(null)).toBe(false);
  });

  it("counts records that look like Kajabi's but carry no offer id in a known shape", () => {
    const records = [
      { data: { metadata: { kjb_offer_id: "o1" } } },
      { data: { metadata: { platform_product_ID: "o2" } } },
      { data: { metadata: { platform_product_name: "Retreat", platform_order_ID: "ord" } } },
      { data: { metadata: { kjb_future_key: "x" } } },
      { data: { metadata: { unrelated: "x" } } },
      { data: null },
    ];
    expect(countUnrecognisedKajabiMetadata(records)).toBe(2);
  });
});
