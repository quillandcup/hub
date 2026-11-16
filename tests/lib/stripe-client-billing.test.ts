import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  invoices: { list: vi.fn(), retrieve: vi.fn() },
  charges: { list: vi.fn() },
}));
vi.mock("stripe", () => ({ default: vi.fn(function () { return sdk; }) }));

import { StripeClientWrapper } from "@/lib/stripe/client";

const page = (data: { id: string }[], has_more: boolean) => ({ data, has_more });

beforeEach(() => vi.clearAllMocks());

describe("StripeClientWrapper invoices and charges", () => {
  it("pages invoices with the cursor, expands only the payments and filters by creation time or status", async () => {
    sdk.invoices.list.mockResolvedValueOnce(page([{ id: "in_1" }, { id: "in_2" }], true)).mockResolvedValueOnce(page([{ id: "in_3" }], false));
    const client = new StripeClientWrapper("sk_test_fake");
    const invoices = await client.fetchInvoices({ createdFrom: 100, status: "open" });
    expect(invoices.map((i) => i.id)).toEqual(["in_1", "in_2", "in_3"]);
    expect(sdk.invoices.list).toHaveBeenNthCalledWith(1, { expand: ["data.payments"], created: { gte: 100 }, status: "open", limit: 100 });
    expect(sdk.invoices.list).toHaveBeenNthCalledWith(2, { expand: ["data.payments"], created: { gte: 100 }, status: "open", limit: 100, starting_after: "in_2" });
  });

  it("asks for every invoice when no filter is given", async () => {
    sdk.invoices.list.mockResolvedValue(page([], false));
    await new StripeClientWrapper("sk_test_fake").fetchInvoices();
    expect(sdk.invoices.list).toHaveBeenCalledWith({ expand: ["data.payments"], limit: 100 });
  });

  it("retrieves one invoice with its payments, and answers null when Stripe has no such invoice", async () => {
    const client = new StripeClientWrapper("sk_test_fake");
    sdk.invoices.retrieve.mockResolvedValueOnce({ id: "in_1" });
    expect(await client.retrieveInvoice("in_1")).toEqual({ id: "in_1" });
    expect(sdk.invoices.retrieve).toHaveBeenCalledWith("in_1", { expand: ["payments"] });

    sdk.invoices.retrieve.mockRejectedValueOnce(Object.assign(new Error("No such invoice"), { statusCode: 404 }));
    expect(await client.retrieveInvoice("in_gone")).toBeNull();

    const denied = Object.assign(new Error("denied"), { statusCode: 403 });
    sdk.invoices.retrieve.mockRejectedValueOnce(denied);
    await expect(client.retrieveInvoice("in_2")).rejects.toBe(denied);
  });

  it("pages charges, from a creation time when given", async () => {
    sdk.charges.list.mockResolvedValueOnce(page([{ id: "ch_1" }], true)).mockResolvedValueOnce(page([{ id: "ch_2" }], false));
    const client = new StripeClientWrapper("sk_test_fake");
    expect((await client.fetchCharges({ createdFrom: 50 })).map((c) => c.id)).toEqual(["ch_1", "ch_2"]);
    expect(sdk.charges.list).toHaveBeenNthCalledWith(1, { created: { gte: 50 }, limit: 100 });

    sdk.charges.list.mockResolvedValue(page([], false));
    await client.fetchCharges();
    expect(sdk.charges.list).toHaveBeenLastCalledWith({ limit: 100 });
  });
});
