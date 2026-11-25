// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MemberTransactionsPanel from "@/app/(admin)/admin/members/[id]/MemberTransactionsPanel";
import type { TransactionRow } from "@/lib/member-transactions";

const row: TransactionRow = {
  id: "in_1", kind: "invoice", createdAt: "2026-03-01T15:00:00Z", createdLabel: "3/1/2026, 10:00 AM", description: "Membership",
  amountCents: 2500, refundedCents: 500, currency: "usd", statusLabel: "Partly refunded", tone: "warn", failureCode: "card_declined", attempts: 2,
  dashboardUrl: "https://dashboard.stripe.com/invoices/in_1",
};

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
});
