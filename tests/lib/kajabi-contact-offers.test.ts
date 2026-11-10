import { describe, expect, it } from "vitest";
import { contactOfferIds, type KajabiContact } from "@/lib/kajabi/client";

const contact = (relationships: KajabiContact["relationships"]) => ({ id: "1", type: "contacts", attributes: {}, relationships }) as unknown as KajabiContact;

describe("contactOfferIds", () => {
  it("reads the offers a contact holds, as strings", () => {
    expect(contactOfferIds(contact({ offers: { data: [{ id: "10", type: "offers" }, { id: 11, type: "offers" }] } }))).toEqual(["10", "11"]);
  });

  it("says none held only when Kajabi spelled out an empty list", () => {
    expect(contactOfferIds(contact({ offers: { data: [] } }))).toEqual([]);
  });

  it("is null when the response did not spell the offers out", () => {
    expect(contactOfferIds(contact({ offers: { links: { self: "https://example.com" } } }))).toBeNull();
    expect(contactOfferIds(contact(undefined))).toBeNull();
  });

  it("reads the list under links.data too, and skips entries without an id", () => {
    expect(contactOfferIds(contact({ offers: { links: { data: [{ id: "7" }, {}] } } }))).toEqual(["7"]);
  });
});
