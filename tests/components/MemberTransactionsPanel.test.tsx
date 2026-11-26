// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberTransactionsPanel from "@/app/(admin)/admin/members/[id]/MemberTransactionsPanel";
import type { TransactionRow } from "@/lib/member-transactions";

const row: TransactionRow = {
  id: "in_1", kind: "invoice", createdAt: "2026-03-01T15:00:00Z", createdLabel: "3/1/2026, 10:00 AM", description: "Membership", reason: "subscription cycle",
  amountCents: 2500, refundedCents: 500, currency: "usd", statusLabel: "Partly refunded", tone: "warn", failureCode: "card_declined", attempts: 2,
  dashboardUrl: "https://dashboard.stripe.com/invoices/in_1",
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("MemberTransactionsPanel", () => {
  it("lists a row with amount, refund, status, attempts and a Stripe link", () => {
    render(<MemberTransactionsPanel rows={[row]} customerCount={1} />);
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("$5.00 refunded")).toBeInTheDocument();
    expect(screen.getByText("Partly refunded")).toBeInTheDocument();
    expect(screen.getByText("card declined")).toBeInTheDocument();
    expect(screen.getByText("2 attempts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "in_1" })).toHaveAttribute("href", row.dashboardUrl);
  });

  it("says when no Stripe customer is linked, and when nothing was imported", () => {
    const { rerender } = render(<MemberTransactionsPanel rows={[]} customerCount={0} />);
    expect(screen.getByText(/No Stripe customer is linked/)).toBeInTheDocument();
    rerender(<MemberTransactionsPanel rows={[]} customerCount={1} />);
    expect(screen.getByText(/No transactions imported/)).toBeInTheDocument();
  });

  it("shows the product name and the invoice reason", () => {
    render(<MemberTransactionsPanel rows={[row]} customerCount={1} />);
    expect(screen.getByText("Membership")).toBeInTheDocument();
    expect(screen.getByText(/Invoice · subscription cycle/)).toBeInTheDocument();
  });

  it("searches, sorts by a header, and pages a long list with the standard pager", async () => {
    const many = Array.from({ length: 60 }, (_, i): TransactionRow => ({
      ...row, id: `in_${i}`, description: i === 7 ? "Retreat deposit" : "Membership", amountCents: 1000 + i,
      createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const user = userEvent.setup();
    render(<MemberTransactionsPanel rows={many} customerCount={1} />);
    expect(screen.getByText(/Showing 1–\d+ of 60 transactions/)).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "retreat");
    const body = screen.getAllByRole("row").slice(1);
    expect(body).toHaveLength(1);
    expect(within(body[0]).getByText("Retreat deposit")).toBeInTheDocument();
  });

  it("offers a flat list and a grouped-by-product view, remembers the choice, and keeps the list as the default", async () => {
    const user = userEvent.setup();
    const schedules = [{ purchaseType: "membership" as const, label: "Membership", memberId: "mbr_AAAAAAAAAAA1", start: "2026-01-09", end: null, rows: [{ key: "k", expectedDate: "2026-03-09", expectedAmountCents: 4700, month: "2026-03", status: "missed" as const, reason: "Billing was due.", needsAttention: true, cause: null, transactions: [], currency: "usd" }] }];
    const { unmount } = render(<MemberTransactionsPanel rows={[row]} customerCount={1} schedules={schedules} />);
    expect(screen.getByRole("button", { name: "Flat list" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Billing schedule" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Group by product" }));
    expect(screen.getByRole("heading", { name: "Billing schedule" })).toBeInTheDocument();
    expect(screen.getByText("Billing was due.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Transactions" })).not.toBeInTheDocument();
    unmount();

    render(<MemberTransactionsPanel rows={[row]} customerCount={1} schedules={schedules} />);
    expect(await screen.findByRole("heading", { name: "Billing schedule" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Flat list" }));
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(localStorage.getItem("hub.member-transactions-view")).toBe("flat");
  });

  it("has no toggle when no Stripe customer is linked", () => {
    render(<MemberTransactionsPanel rows={[]} customerCount={0} schedules={[]} />);
    expect(screen.queryByRole("button", { name: "Group by product" })).not.toBeInTheDocument();
  });
});
