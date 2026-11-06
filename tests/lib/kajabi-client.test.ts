import { describe, it, expect, vi, beforeEach } from "vitest";
import { KajabiClient, contactAttachments, isEmptyContact, type KajabiContact } from "@/lib/kajabi/client";

function mockFetchSequence(responses: { ok: boolean; status?: number; json: any }[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockImplementationOnce(async () => ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.json,
      text: async () => JSON.stringify(response.json),
    }));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("KajabiClient.updateContact", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes /v1/contacts/{id} with the given attributes", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: "token-123", expires_in: 3600 } },
      {
        ok: true,
        json: { data: { id: "456", type: "contacts", attributes: { name: "Erica Haraldsen" } } },
      },
    ]);

    const client = new KajabiClient("client-id", "client-secret", "site-id");
    const result = await client.updateContact("456", { name: "Erica Haraldsen" });

    expect(result.attributes.name).toBe("Erica Haraldsen");

    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toBe("https://api.kajabi.com/v1/contacts/456");
    expect(patchCall[1].method).toBe("PATCH");
    expect(JSON.parse(patchCall[1].body)).toEqual({
      data: { type: "contacts", id: "456", attributes: { name: "Erica Haraldsen" } },
    });
  });

  it("throws when Kajabi returns an error", async () => {
    mockFetchSequence([
      { ok: true, json: { access_token: "token-123", expires_in: 3600 } },
      { ok: false, status: 422, json: { error: "Invalid name" } },
    ]);

    const client = new KajabiClient("client-id", "client-secret", "site-id");
    await expect(client.updateContact("456", { name: "" })).rejects.toThrow(/Kajabi API error/);
  });

  it("sends contact custom fields (e.g. the Instagram Handle custom_1)", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: "token-123", expires_in: 3600 } },
      { ok: true, json: { data: { id: "456", type: "contacts", attributes: { custom_1: "hedgie" } } } },
    ]);

    const client = new KajabiClient("client-id", "client-secret", "site-id");
    await client.updateContact("456", { custom_1: "hedgie" });

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      data: { type: "contacts", id: "456", attributes: { custom_1: "hedgie" } },
    });
  });
});

describe("KajabiClient.fetchContact", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs one contact with include=tags and resolves tag names like the paginated fetch", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: "token-123", expires_in: 3600 } },
      {
        ok: true,
        json: {
          data: {
            id: "456",
            type: "contacts",
            attributes: { name: "Test Person", email: "test@example.com", custom_1: "hedgie" },
            relationships: { tags: { data: [{ id: "t1", type: "contact_tags" }] } },
          },
          included: [{ id: "t1", type: "contact_tags", attributes: { name: "Ideal Hedgie" } }],
        },
      },
    ]);

    const client = new KajabiClient("client-id", "client-secret", "site-id");
    const contact = await client.fetchContact("456");

    expect(fetchMock.mock.calls[1][0]).toBe("https://api.kajabi.com/v1/contacts/456?include=tags");
    expect(contact.tags).toEqual(["Ideal Hedgie"]);
    expect(contact.attributes.custom_1).toBe("hedgie");
  });
});

const contact = (extra: Partial<KajabiContact>): KajabiContact => ({ id: "9", type: "contacts", attributes: {} as KajabiContact["attributes"], ...extra });

describe("what is attached to a contact", () => {
  it("is empty only when Kajabi says there is no customer, no tags and no offers", () => {
    const empty = contact({ relationships: { tags: { data: [] }, offers: { data: [] }, customer: { data: null } } });
    expect(isEmptyContact(empty)).toBe(true);
    expect(contactAttachments(empty)).toEqual({ hasCustomer: false, tagCount: 0, offerCount: 0 });
    // The offers list sits under `links` in some responses.
    expect(isEmptyContact(contact({ relationships: { tags: { data: [] }, offers: { links: { data: [] } } } }))).toBe(true);
  });

  it("is not empty with a customer (as a link or a relationship), a tag or an offer", () => {
    const base = { tags: { data: [] }, offers: { data: [] } };
    expect(isEmptyContact(contact({ links: { customer: "https://app.kajabi.com/api/v1/customers/1" }, relationships: base }))).toBe(false);
    expect(isEmptyContact(contact({ relationships: { ...base, customer: { data: { id: "1", type: "customers" } } } }))).toBe(false);
    expect(isEmptyContact(contact({ relationships: { ...base, tags: { data: [{ id: "1", type: "contact_tags" }] } } }))).toBe(false);
    expect(isEmptyContact(contact({ relationships: { ...base, offers: { data: [{ id: "1", type: "offers" }] } } }))).toBe(false);
  });

  it("counts anything the response did not spell out as not empty", () => {
    expect(isEmptyContact(contact({}))).toBe(false);
    expect(isEmptyContact(contact({ relationships: { tags: { data: [] }, offers: { links: { self: "x" } } } }))).toBe(false);
    expect(contactAttachments(contact({ relationships: { tags: { data: [] }, offers: { links: { self: "x" } } } })).offerCount).toBeNull();
  });
});

describe("KajabiClient.fetchContactWithAttachments and deleteContact", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the offers, tags and customer with the contact", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: "token-123", expires_in: 3600 } },
      { ok: true, json: { data: { id: "9", type: "contacts", attributes: {}, relationships: { tags: { data: [] } } } } },
    ]);
    const client = new KajabiClient("client-id", "client-secret", "site-id");

    expect((await client.fetchContactWithAttachments("9")).id).toBe("9");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.kajabi.com/v1/contacts/9?include=offers%2Ctags%2Ccustomer");

    mockFetchSequence([{ ok: true, json: { access_token: "token-123", expires_in: 3600 } }, { ok: true, json: {} }]);
    await expect(new KajabiClient("client-id", "client-secret", "site-id").fetchContactWithAttachments("9")).rejects.toThrow(/no contact/);
  });

  it("DELETEs /v1/contacts/{id}, accepts a reply with no body, and passes on Kajabi's refusals", async () => {
    const fetchMock = mockFetchSequence([{ ok: true, json: { access_token: "token-123", expires_in: 3600 } }, { ok: true, json: { data: {} } }]);
    await new KajabiClient("client-id", "client-secret", "site-id").deleteContact("9");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.kajabi.com/v1/contacts/9");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }), text: async () => "" })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); }, text: async () => "" })
    );
    await expect(new KajabiClient("client-id", "client-secret", "site-id").deleteContact("9")).resolves.toBeUndefined();

    mockFetchSequence([{ ok: true, json: { access_token: "token-123", expires_in: 3600 } }, { ok: false, status: 403, json: { error: "Forbidden" } }]);
    await expect(new KajabiClient("client-id", "client-secret", "site-id").deleteContact("9")).rejects.toThrow(/Kajabi API error \(403\)/);
  });
});
