// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const actions = vi.hoisted(() => ({ acknowledge: vi.fn(async () => ({ ok: true })), revoke: vi.fn(async () => ({ ok: true })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/hygiene/billing-reconciliation/actions", () => ({ acknowledgeBillingRow: actions.acknowledge, revokeBillingAcknowledgement: actions.revoke }));

import BillingSchedule from "@/components/BillingSchedule";
import type { AckView } from "@/lib/billing-acknowledgements";
import type { PurchaseSchedule, ScheduleRow } from "@/lib/billing-reconciliation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (key: string, status: ScheduleRow["status"], needsAttention: boolean): ScheduleRow => ({
  key,
  expectedDate: "2026-03-09",
  expectedAmountCents: 4700,
  month: "2026-03",
  status,
  reason: `reason ${key}`,
  needsAttention,
  cause: null,
  transactions: [],
  currency: "usd",
});
const schedule = (rows: ScheduleRow[]): PurchaseSchedule => ({ purchaseType: "membership", label: "Membership", memberId: "mbr_AAAAAAAAAAA1", start: "2026-01-09", end: null, rows, notes: [] });
const ack = (extra: Partial<AckView> = {}): AckView => ({ reason: "gift", note: null, by: "dana@example.test", day: "2026-05-30", statusAtAck: "missed", amountCentsAtAck: 4700, state: "applies", ...extra });

describe("BillingSchedule on a member's Transactions tab, with acknowledgements", () => {
  it("counts a row an acknowledgement settles as no longer needing a look, and hides it with the others", () => {
    render(<BillingSchedule schedules={[schedule([row("a", "missed", true), row("b", "missed", true)])]} acknowledgements={{ a: ack() }} />);
    expect(screen.getByLabelText(/Only rows that need a look \(1\)/)).toBeChecked();
    expect(screen.queryByText("reason a")).not.toBeInTheDocument();
    expect(screen.getByText("reason b")).toBeInTheDocument();
  });

  it("starts on all rows when every row that needed a look is acknowledged, and shows the decision under the row", async () => {
    render(<BillingSchedule schedules={[schedule([row("a", "missed", true)])]} acknowledgements={{ a: ack() }} />);
    expect(screen.getByLabelText(/Only rows that need a look \(0\)/)).not.toBeChecked();
    expect(screen.getByText("reason a")).toBeInTheDocument();
    expect(screen.getByTestId("ack-summary")).toHaveTextContent("Gift Marked by dana@example.test on 2026-05-30.");
    expect(screen.queryByRole("button", { name: /Mark|Undo/ })).not.toBeInTheDocument();
  });

  it("keeps a row that changed since it was marked in the list, with the words, and counts it", () => {
    render(<BillingSchedule schedules={[schedule([row("a", "missed", true)])]} acknowledgements={{ a: ack({ state: "changed" }) }} />);
    expect(screen.getByLabelText(/Only rows that need a look \(1\)/)).toBeChecked();
    expect(screen.getByText("Was marked gift on 2026-05-30, but it has changed since.")).toBeInTheDocument();
  });

  it("offers Mark as only on rows that need a look, and only to who may", () => {
    const rows = [row("a", "missed", true), row("b", "paid", false)];
    const { rerender } = render(<BillingSchedule schedules={[schedule(rows)]} />);
    expect(screen.queryByRole("button", { name: "Mark as…" })).not.toBeInTheDocument();
    rerender(<BillingSchedule schedules={[schedule(rows)]} canAcknowledge />);
    expect(screen.getAllByRole("button", { name: "Mark as…" })).toHaveLength(1);
  });

  it("marks a row from here and tells the page to read again", async () => {
    const onChange = vi.fn();
    render(<BillingSchedule schedules={[schedule([row("a", "missed", true)])]} canAcknowledge onAcknowledgementChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as…" }));
    await userEvent.click(screen.getByRole("button", { name: /Mark it/ }));
    expect(actions.acknowledge).toHaveBeenCalledWith({ rowKey: "a", reason: "comp", note: "" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
