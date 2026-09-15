import { describe, it, expect, vi, beforeEach } from "vitest";
import { KajabiClient } from "@/lib/kajabi/client";

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
});
