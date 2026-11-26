// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import BillingSchedule from "@/components/BillingSchedule";
import type { PurchaseSchedule, ScheduleRow } from "@/lib/billing-reconciliation";

afterEach(cleanup);

const row = (key: string, expectedDate: string | null, status: ScheduleRow["status"], extra: Partial<ScheduleRow> = {}): ScheduleRow => ({
  key,
  expectedDate,
  expectedAmountCents: 4700,
  month: (expectedDate ?? "2026-03-20").slice(0, 7),
  status,
  reason: `reason ${key}`,
  needsAttention: false,
  cause: null,
  transactions: [],
  currency: "usd",
  ...extra,
});
const schedule = (rows: ScheduleRow[]): PurchaseSchedule => ({ purchaseType: "membership", label: "Membership", memberId: "mbr_AAAAAAAAAAA1", start: "2026-01-09", end: null, rows });
const tx = { invoiceId: "in_1", chargeIds: [], day: "2026-02-09", billedCents: 4700, keptCents: 4700, refundedCents: 0, invoiceStatus: "paid", failureCodes: [], attempts: 1 };

describe("BillingSchedule", () => {
  it("says so when there is nothing to line up", () => {
    render(<BillingSchedule schedules={[]} />);
    expect(screen.getByText(/No membership billing to line up/)).toBeInTheDocument();
  });

  it("shows the summary and starts on the rows that need a look, with a switch to all rows", async () => {
    const rows = [
      row("a", "2026-02-09", "paid", { transactions: [tx] }),
      row("b", "2026-03-09", "missed", { needsAttention: true }),
      row("c", null, "unexpected", { needsAttention: true, expectedAmountCents: null }),
    ];
    render(<BillingSchedule schedules={[schedule(rows)]} />);
    const summary = screen.getByLabelText("Summary");
    expect(within(summary).getByText("Paid: 1")).toBeInTheDocument();
    expect(within(summary).getByText("Missed: 1")).toBeInTheDocument();
    expect(screen.getByText("reason b")).toBeInTheDocument();
    expect(screen.getByText("reason c")).toBeInTheDocument();
    expect(screen.queryByText("reason a")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Only rows that need a look \(2\)/));
    expect(screen.getByText("reason a")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "in_1" })).toHaveAttribute("href", "https://dashboard.stripe.com/invoices/in_1");
    expect(screen.getByText("from 2026-01-09")).toBeInTheDocument();
  });

  it("shows everything when nothing needs a look, and says nothing needs one when filtered to none", async () => {
    render(<BillingSchedule schedules={[schedule([row("a", "2026-02-09", "paid")])]} />);
    expect(screen.getByText("reason a")).toBeInTheDocument();
    cleanup();
    render(<BillingSchedule schedules={[schedule([row("a", "2026-02-09", "paid")])]} problemsFirst />);
    expect(screen.getByLabelText(/Only rows that need a look \(0\)/)).not.toBeChecked();
  });

  it("notes a purchase that has ended", () => {
    render(<BillingSchedule schedules={[{ ...schedule([row("a", "2026-02-09", "paid")]), end: "2026-03-20" }]} />);
    expect(screen.getByText("from 2026-01-09 to 2026-03-20")).toBeInTheDocument();
  });
});
