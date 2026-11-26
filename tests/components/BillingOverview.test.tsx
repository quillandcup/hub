// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BillingOverview, { PROBLEM_FILTERS, parseProblemFilter } from "@/app/(admin)/admin/hygiene/billing-reconciliation/BillingOverview";
import type { BillingOverview as Overview } from "@/lib/billing-reconciliation-loader";
import type { PurchaseSchedule, ScheduleRow } from "@/lib/billing-reconciliation";

afterEach(cleanup);

const MEMBER = "mbr_AAAAAAAAAAA1";
const row = (key: string, status: ScheduleRow["status"], extra: Partial<ScheduleRow> = {}): ScheduleRow => ({
  key,
  expectedDate: null,
  expectedAmountCents: null,
  month: "2026-03",
  status,
  reason: `reason ${key}`,
  needsAttention: true,
  cause: null,
  transactions: [],
  currency: "usd",
  ...extra,
});
const eventSchedule = (rows: ScheduleRow[]): PurchaseSchedule => ({
  purchaseType: "event",
  label: "Spring Retreat",
  key: `${MEMBER}:event:evt_1:p1`,
  memberId: MEMBER,
  start: "2026-02-01",
  end: null,
  rows,
  notes: [],
  event: { id: "evt_1", slug: "spring-retreat", title: "Spring Retreat" },
  purchase: { purchaseId: "p1", offerName: "Spring Retreat ticket", priceText: "$500.00 one time", day: "2026-02-01", amountCents: 50000, quantity: 1, granted: false, status: "active" },
});
const membership = (): PurchaseSchedule => ({ purchaseType: "membership", label: "Membership", memberId: MEMBER, start: null, end: null, notes: [], rows: [row("m", "missed")] });
const overview = (schedules: PurchaseSchedule[]): Overview => ({
  schedules,
  members: new Map([[MEMBER, { id: MEMBER, name: "Ada Example", displayName: null, status: "active" }]]),
  today: "2026-06-01",
  counts: { linkedMembers: 1, invoices: 3, charges: 0, subscriptions: 1, purchases: 1 },
});

describe("BillingOverview events", () => {
  it("lists an event finding with its event page and the member's Transactions tab, one line per purchase", () => {
    render(<BillingOverview overview={overview([membership(), eventSchedule([row("e", "missing_payment")])])} filter="missing_payment" />);
    expect(screen.getByRole("link", { name: "Spring Retreat" })).toHaveAttribute("href", "/admin/events/spring-retreat");
    expect(screen.getByRole("link", { name: "Ada Example" })).toHaveAttribute("href", `/admin/members/${MEMBER}/transactions`);
    expect(screen.getByText("Spring Retreat ticket")).toBeInTheDocument();
    expect(screen.getByText(/reason e/)).toBeInTheDocument();
    expect(screen.queryByText(/reason m/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 event, program and course purchases/)).toBeInTheDocument();
  });

  it("filters granted purchases and unexplained payments", () => {
    const schedules = [eventSchedule([row("g", "granted_no_override", { cause: "granted" }), row("u", "unexplained_payment", { cause: "event" })])];
    render(<BillingOverview overview={overview(schedules)} filter="granted" />);
    expect(screen.getByText(/reason g/)).toBeInTheDocument();
    expect(screen.queryByText(/reason u/)).not.toBeInTheDocument();
    cleanup();
    render(<BillingOverview overview={overview(schedules)} filter="unexplained_payment" />);
    expect(within(screen.getByLabelText("Filter")).getByRole("link", { name: /Paid, not explained/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/reason u/)).toBeInTheDocument();
  });

  it("knows the new filters by id", () => {
    expect(PROBLEM_FILTERS.map((f) => f.id)).toEqual(expect.arrayContaining(["missing_payment", "unexplained_payment", "granted"]));
    expect(parseProblemFilter("granted")).toBe("granted");
    expect(parseProblemFilter("nope")).toBe("all");
  });
});
