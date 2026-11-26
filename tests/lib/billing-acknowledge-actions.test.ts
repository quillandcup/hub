import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { BillingOverview } from "@/lib/billing-reconciliation-loader";
import type { PurchaseSchedule, ScheduleRow } from "@/lib/billing-reconciliation";

const MEMBER = "mbr_AAAAAAAAAAA1";
const STAFF = "user-dana";
const KEY = `${MEMBER}:event:evt_1:kp_1:1`;

const admin = vi.hoisted(() => ({ result: null as unknown, permission: "" }));
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: async (permission: string) => {
    admin.permission = permission;
    return admin.result;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_action: string, run: () => Promise<unknown>) => run() }));

// What the overview says right now; each test sets it.
const overviewNow = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing-reconciliation-loader", () => ({ loadBillingOverview: async () => overviewNow.value }));

// The signed-in person's own repositories (the write) and the service ones (the overview's read) are different datasets, so the test can tell them apart.
let own: InMemoryDataset;
let service: InMemoryDataset;
vi.mock("@/lib/data/server", () => ({
  getRepos: async () => createInMemoryRepos(own),
  getServiceRepos: () => createInMemoryRepos(service),
}));

const { acknowledgeBillingRow, revokeBillingAcknowledgement } = await import("@/app/(admin)/admin/hygiene/billing-reconciliation/actions");

const row = (extra: Partial<ScheduleRow> = {}): ScheduleRow => ({
  key: KEY,
  expectedDate: "2026-05-01",
  expectedAmountCents: 69700,
  month: "2026-05",
  status: "missing_payment",
  reason: "Bought, no Stripe payment",
  needsAttention: true,
  cause: null,
  transactions: [],
  currency: "usd",
  ...extra,
});
const schedule = (rows: ScheduleRow[]): PurchaseSchedule => ({ purchaseType: "event", label: "Seed Launch", memberId: MEMBER, start: null, end: null, notes: [], rows });
const setOverview = (rows: ScheduleRow[]) => {
  overviewNow.value = {
    schedules: [schedule(rows)],
    members: new Map([[MEMBER, { id: MEMBER, name: "Ada Example", displayName: null, status: "active" }]]),
    today: "2026-06-01",
    counts: { linkedMembers: 1, invoices: 1, charges: 0, subscriptions: 0, purchases: 1, unrecognisedKajabiCharges: 0 },
  } satisfies BillingOverview;
};
const stored = async () => (await createInMemoryRepos(own).billingAcknowledgements.activeFor(KEY));
const everyRow = () => own.billingAcknowledgements;

beforeEach(() => {
  admin.result = { ok: true, user: { id: STAFF }, roles: ["admin"] };
  admin.permission = "";
  own = new InMemoryDataset({ members: [{ id: MEMBER, name: "Ada Example" }] } as never);
  service = new InMemoryDataset({ members: [{ id: MEMBER, name: "Ada Example" }] } as never);
  setOverview([row()]);
});

describe("acknowledgeBillingRow", () => {
  it("asks for its own permission and refuses without it, writing nothing", async () => {
    admin.result = { ok: false, error: "Not authorized" };
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" })).toEqual({ ok: false, error: "Not authorized" });
    expect(admin.permission).toBe("billing.reconciliation.acknowledge");
    expect(everyRow()).toEqual([]);
  });

  it("records the reason and note, with the status, amount, member and kind of purchase taken from the server's row", async () => {
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "comp", note: "  Seed launch, promised  " })).toEqual({ ok: true });
    expect(await stored()).toMatchObject({
      rowKey: KEY,
      memberId: MEMBER,
      purchaseType: "event",
      reason: "comp",
      note: "Seed launch, promised",
      statusAtAck: "missing_payment",
      amountCentsAtAck: 69700,
      acknowledgedBy: STAFF,
      revokedAt: null,
    });
  });

  it("never trusts a status, amount or member the client sends along", async () => {
    const forged = { rowKey: KEY, reason: "gift", status: "paid", amountCents: 1, memberId: "mbr_ZZZZZZZZZZZ9", statusAtAck: "paid" } as unknown as Parameters<typeof acknowledgeBillingRow>[0];
    expect(await acknowledgeBillingRow(forged)).toEqual({ ok: true });
    expect(await stored()).toMatchObject({ memberId: MEMBER, statusAtAck: "missing_payment", amountCentsAtAck: 69700 });
  });

  it("writes as the signed-in person's own client, not the service role", async () => {
    await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" });
    expect(own.billingAcknowledgements).toHaveLength(1);
    expect(service.billingAcknowledgements).toEqual([]);
  });

  it("rejects a row the overview does not list as needing a look", async () => {
    expect(await acknowledgeBillingRow({ rowKey: "mbr_AAAAAAAAAAA1:event:evt_1:other:1", reason: "comp" })).toMatchObject({ ok: false, error: expect.stringContaining("not on the billing reconciliation page") });
    setOverview([row({ needsAttention: false, status: "paid" })]);
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" })).toMatchObject({ ok: false });
    expect(everyRow()).toEqual([]);
  });

  it("rejects a missing or odd key, an unknown reason, a long note, and other without a note", async () => {
    expect(await acknowledgeBillingRow({ rowKey: "", reason: "comp" })).toEqual({ ok: false, error: "Row not found." });
    expect(await acknowledgeBillingRow({ rowKey: "k".repeat(301), reason: "comp" })).toEqual({ ok: false, error: "Row not found." });
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "because" as never })).toEqual({ ok: false, error: "Choose a reason." });
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "gift", note: "x".repeat(501) })).toMatchObject({ ok: false, error: expect.stringContaining("500") });
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "other", note: "   " })).toEqual({ ok: false, error: "Add a note saying what this is." });
    expect(everyRow()).toEqual([]);
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "other", note: "Cash at the retreat" })).toEqual({ ok: true });
  });

  it("is idempotent: marking the same thing again changes nothing", async () => {
    await acknowledgeBillingRow({ rowKey: KEY, reason: "comp", note: "n" });
    const before = structuredClone(everyRow());
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "comp", note: "n" })).toEqual({ ok: true });
    expect(everyRow()).toEqual(before);
  });

  it("replaces a mark with a different reason: the old one is kept as revoked, with who", async () => {
    await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" });
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "gift" })).toEqual({ ok: true });
    expect(everyRow().map((r) => [r.reason, r.revoked_at !== null, r.revoked_by])).toEqual([
      ["comp", true, STAFF],
      ["gift", false, null],
    ]);
    expect(await stored()).toMatchObject({ reason: "gift" });
  });

  it("re-marks a row whose amount grew since, recording what it is now", async () => {
    await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" });
    setOverview([row({ expectedAmountCents: 99700 })]);
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" })).toEqual({ ok: true });
    expect(everyRow()).toHaveLength(2);
    expect(await stored()).toMatchObject({ statusAtAck: "missing_payment", amountCentsAtAck: 99700 });
  });

  it("says so when the save fails, without the database's words", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    own.members = [];
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" })).toEqual({ ok: false, error: "Couldn't save." });
    spy.mockRestore();
  });
});

describe("revokeBillingAcknowledgement", () => {
  it("asks for its own permission and refuses without it, changing nothing", async () => {
    await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" });
    admin.result = { ok: false, error: "Not authorized" };
    expect(await revokeBillingAcknowledgement({ rowKey: KEY })).toEqual({ ok: false, error: "Not authorized" });
    expect(admin.permission).toBe("billing.reconciliation.acknowledge");
    expect(await stored()).not.toBeNull();
  });

  it("revokes, keeping who and when, and the row can be marked again", async () => {
    await acknowledgeBillingRow({ rowKey: KEY, reason: "comp" });
    admin.result = { ok: true, user: { id: "user-eve" }, roles: ["admin"] };
    expect(await revokeBillingAcknowledgement({ rowKey: KEY })).toEqual({ ok: true });
    expect(await stored()).toBeNull();
    expect(everyRow()).toHaveLength(1);
    expect(everyRow()[0]).toMatchObject({ acknowledged_by: STAFF, revoked_by: "user-eve" });
    expect(everyRow()[0].revoked_at).toBeTruthy();
    expect(await acknowledgeBillingRow({ rowKey: KEY, reason: "gift" })).toEqual({ ok: true });
    expect(await stored()).toMatchObject({ reason: "gift" });
  });

  it("treats nothing to undo as done, and rejects an empty key", async () => {
    expect(await revokeBillingAcknowledgement({ rowKey: KEY })).toEqual({ ok: true });
    expect(await revokeBillingAcknowledgement({ rowKey: "" })).toEqual({ ok: false, error: "Row not found." });
    expect(everyRow()).toEqual([]);
  });
});
