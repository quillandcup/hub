import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const admin = vi.hoisted(() => ({ result: { ok: true } as { ok: true } | { ok: false; error: string }, permission: "" }));
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: async (permission: string) => {
    admin.permission = permission;
    return admin.result;
  },
}));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/server", () => ({
  getRepos: async () => createInMemoryRepos(dataset),
  getServiceRepos: () => createInMemoryRepos(dataset),
}));

const { loadMemberTransactions } = await import("@/app/(admin)/admin/members/[id]/transactions-actions");

const MEMBER = "mbr_AAAAAAAAAAA1";
const invoice = (id: string, customer: string, extra: Record<string, unknown> = {}) => ({
  stripe_invoice_id: id, stripe_customer_id: customer, status: "paid", amount_paid: 2500, amount_due: 2500,
  created_at_stripe: "2026-03-01T15:00:00Z", billing_reason: "subscription_cycle", ...extra,
});

beforeEach(() => {
  admin.result = { ok: true };
  dataset = new InMemoryDataset({
    members: [{ id: MEMBER, name: "Ada Example", email: "Ada@Example.test", stripeCustomerId: "cus_linked" }],
    emailAliases: [{ id: "ea1", memberId: MEMBER, member_id: MEMBER, alias_email: "old@example.test", canonical_email: "ada@example.test", active: true }],
    stripeCustomers: [
      { stripe_customer_id: "cus_linked", email: "ada@example.test" },
      { stripe_customer_id: "cus_old", email: "old@example.test" },
      { stripe_customer_id: "cus_other", email: "someone@example.test" },
    ],
    stripeProducts: [{ stripe_product_id: "prod_m", name: "Monthly Membership" }],
    stripeInvoices: [
      invoice("in_linked", "cus_linked", { stripe_product_id: "prod_m" }),
      invoice("in_old", "cus_old", { created_at_stripe: "2026-02-01T00:00:00Z" }),
      invoice("in_other", "cus_other"),
    ],
  } as never);
});

describe("loadMemberTransactions", () => {
  it("asks for the Transactions permission and refuses without it", async () => {
    admin.result = { ok: false, error: "Not authorized" };
    expect(await loadMemberTransactions(MEMBER)).toEqual({ error: "Not authorized" });
    expect(admin.permission).toBe("member.transactions_tab");
  });

  it("finds the linked customer's and the alias-email customer's invoices, with product names, not anyone else's", async () => {
    const result = await loadMemberTransactions(MEMBER);
    if ("error" in result) throw new Error(result.error);
    expect(result.customerCount).toBe(2);
    expect(result.rows.map((r) => r.id)).toEqual(["in_linked", "in_old"]);
    expect(result.rows[0]).toMatchObject({ description: "Monthly Membership", reason: "subscription cycle" });
    // No subscription is imported for the member, so the schedule has nothing to expect and one unmatched payment.
    expect(result.schedules.map((s) => s.purchaseType)).toEqual([]);
  });

  it("says no customer when none is linked or found", async () => {
    dataset = new InMemoryDataset({ members: [{ id: MEMBER, name: "Ada Example", email: "nobody@example.test" }] } as never);
    expect(await loadMemberTransactions(MEMBER)).toEqual({ rows: [], customerCount: 0, schedules: [] });
  });

  it("refuses a bad id and an unknown member", async () => {
    expect(await loadMemberTransactions("not-an-id")).toEqual({ error: "Member not found." });
    expect(await loadMemberTransactions("mbr_ZZZZZZZZZZZ9")).toEqual({ error: "Member not found." });
  });
});
