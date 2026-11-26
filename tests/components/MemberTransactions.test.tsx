// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const load = vi.hoisted(() => vi.fn());
const markRow = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/app/(admin)/admin/members/[id]/transactions-actions", () => ({ loadMemberTransactions: load }));
vi.mock("@/app/(admin)/admin/hygiene/billing-reconciliation/actions", () => ({ acknowledgeBillingRow: markRow, revokeBillingAcknowledgement: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import MemberTransactions from "@/app/(admin)/admin/members/[id]/MemberTransactions";

afterEach(() => {
  cleanup();
  load.mockReset();
});

describe("MemberTransactions", () => {
  it("shows a loading line, then the table", async () => {
    load.mockResolvedValue({ rows: [], customerCount: 1 });
    render(<MemberTransactions memberId="mbr_AAAAAAAAAAA1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading transactions");
    expect(await screen.findByText(/No transactions imported/)).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("mbr_AAAAAAAAAAA1");
  });

  it("reads the tab again, without the loading line, after a billing row is marked or undone", async () => {
    const row = {
      key: "mbr_AAAAAAAAAAA1:membership:2026-03",
      expectedDate: "2026-03-09",
      expectedAmountCents: 4700,
      month: "2026-03",
      status: "missed",
      reason: "reason one",
      needsAttention: true,
      cause: null,
      transactions: [],
      currency: "usd",
    };
    const schedules = [{ purchaseType: "membership", label: "Membership", memberId: "mbr_AAAAAAAAAAA1", start: null, end: null, notes: [], rows: [row] }];
    load.mockResolvedValue({ rows: [], customerCount: 1, schedules, acknowledgements: {}, canAcknowledge: true });
    render(<MemberTransactions memberId="mbr_AAAAAAAAAAA1" />);
    await screen.findByText(/No transactions imported/);
    await userEvent.click(screen.getByRole("button", { name: "Group by product" }));
    expect(load).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Mark as…" }));
    await userEvent.click(screen.getByRole("button", { name: /Mark it/ }));
    expect(markRow).toHaveBeenCalledWith({ rowKey: row.key, reason: "comp", note: "" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the reason when the load is refused or fails", async () => {
    load.mockResolvedValueOnce({ error: "Not authorized" });
    const { unmount } = render(<MemberTransactions memberId="m1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized");
    unmount();
    load.mockRejectedValueOnce(new Error("boom"));
    render(<MemberTransactions memberId="m2" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the transactions.");
  });
});
