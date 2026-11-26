import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { PurchaseSchedule } from "@/lib/billing-reconciliation";

const MEMBER = "mbr_AAAAAAAAAAA1";
const KEY = `${MEMBER}:membership:2026-03`;

const admin = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: async () => admin.result }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/server", () => ({
  getRepos: async () => createInMemoryRepos(dataset),
  getServiceRepos: () => createInMemoryRepos(dataset),
}));
// The member's schedules are built elsewhere (billing-reconciliation-loader tests); here one row needs a look.
const schedules = vi.hoisted(() => ({ value: [] as PurchaseSchedule[] }));
vi.mock("@/lib/billing-reconciliation-loader", () => ({ loadMemberSchedules: async () => schedules.value }));

const { loadMemberTransactions } = await import("@/app/(admin)/admin/members/[id]/transactions-actions");

const as = (roles: string[]) => ({ ok: true, user: { id: "user-1" }, roles });

beforeEach(() => {
  schedules.value = [
    {
      purchaseType: "membership",
      label: "Membership",
      memberId: MEMBER,
      start: null,
      end: null,
      notes: [],
      rows: [{ key: KEY, expectedDate: "2026-03-09", expectedAmountCents: 4700, month: "2026-03", status: "missed", reason: "r", needsAttention: true, cause: null, transactions: [], currency: "usd" }],
    },
  ];
  dataset = new InMemoryDataset({
    members: [{ id: MEMBER, name: "Ada Example", email: "ada@example.test", stripeCustomerId: "cus_linked" }],
    stripeCustomers: [{ stripe_customer_id: "cus_linked", email: "ada@example.test" }],
    userProfiles: [{ id: "user-1", email: "dana@example.test" }],
    billingAcknowledgements: [
      {
        id: "brak_AAAAAAAAAAA1",
        row_key: KEY,
        member_id: MEMBER,
        purchase_type: "membership",
        reason: "gift",
        note: "A gifted month",
        status_at_ack: "missed",
        amount_cents_at_ack: 4700,
        acknowledged_by: "user-1",
        acknowledged_at: "2026-05-30T16:00:00Z",
        revoked_by: null,
        revoked_at: null,
      },
    ],
  } as never);
});

describe("loadMemberTransactions, acknowledgements", () => {
  it("gives staff who may read the reconciliation page each row's decision and who made it, and says whether they may mark", async () => {
    admin.result = as(["admin"]);
    const result = await loadMemberTransactions(MEMBER);
    if ("error" in result) throw new Error(result.error);
    expect(result.canAcknowledge).toBe(true);
    expect(result.acknowledgements).toEqual({ [KEY]: { reason: "gift", note: "A gifted month", by: "dana@example.test", day: "2026-05-30", statusAtAck: "missed", amountCentsAtAck: 4700, state: "applies" } });
  });

  it("judges the decision against the row as it is now", async () => {
    admin.result = as(["admin"]);
    schedules.value[0].rows[0].expectedAmountCents = 9400;
    const result = await loadMemberTransactions(MEMBER);
    if ("error" in result) throw new Error(result.error);
    expect(result.acknowledgements?.[KEY].state).toBe("changed");
  });

  it("shows none, and no way to mark, to a role that may open the tab but not the reconciliation page", async () => {
    admin.result = as(["community_manager"]);
    const result = await loadMemberTransactions(MEMBER);
    if ("error" in result) throw new Error(result.error);
    expect(result.acknowledgements).toEqual({});
    expect(result.canAcknowledge).toBe(false);
  });
});
