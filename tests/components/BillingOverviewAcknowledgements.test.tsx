// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/hygiene/billing-reconciliation",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(admin)/admin/hygiene/billing-reconciliation/actions", () => ({ acknowledgeBillingRow: vi.fn(), revokeBillingAcknowledgement: vi.fn() }));

import BillingOverview from "@/app/(admin)/admin/hygiene/billing-reconciliation/BillingOverview";
import type { AckRecord } from "@/lib/billing-acknowledgements";
import type { BillingOverview as Overview } from "@/lib/billing-reconciliation-loader";
import type { PurchaseSchedule, ScheduleRow } from "@/lib/billing-reconciliation";

afterEach(cleanup);

const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const SEED = `${ADA}:event:evt_1:kp_1:1`;
const MISSED = `${BEA}:membership:2026-05`;

const row = (key: string, status: ScheduleRow["status"], extra: Partial<ScheduleRow> = {}): ScheduleRow => ({
  key,
  expectedDate: "2026-05-09",
  expectedAmountCents: 4700,
  month: "2026-05",
  status,
  reason: `reason ${key}`,
  needsAttention: true,
  cause: null,
  transactions: [],
  currency: "usd",
  ...extra,
});
const schedules = (seedStatus: ScheduleRow["status"] = "missing_payment", seedAmount = 69700): PurchaseSchedule[] => [
  {
    purchaseType: "event",
    label: "Seed Launch",
    key: `${ADA}:event:evt_1:kp_1`,
    memberId: ADA,
    start: null,
    end: null,
    notes: [],
    rows: [row(SEED, seedStatus, { expectedAmountCents: seedAmount })],
    event: { id: "evt_1", slug: "seed-launch", title: "Seed Launch" },
  },
  { purchaseType: "membership", label: "Membership", key: `${BEA}:membership`, memberId: BEA, start: null, end: null, notes: [], rows: [row(MISSED, "missed")] },
];
const overview = (list: PurchaseSchedule[]): Overview => ({
  schedules: list,
  members: new Map([
    [ADA, { id: ADA, name: "Ada Example", displayName: null, status: "active" }],
    [BEA, { id: BEA, name: "Bea Example", displayName: null, status: "active" }],
  ]),
  today: "2026-06-01",
  counts: { linkedMembers: 2, invoices: 3, charges: 0, subscriptions: 2, purchases: 1 },
});
const record = (extra: Partial<AckRecord> = {}): AckRecord => ({
  rowKey: SEED,
  memberId: ADA,
  purchaseType: "event",
  reason: "comp",
  note: "Seed launch, promised",
  statusAtAck: "missing_payment",
  amountCentsAtAck: 69700,
  acknowledgedBy: "user-1",
  acknowledgedAt: "2026-05-30T16:00:00Z",
  revokedBy: null,
  revokedAt: null,
  ...extra,
});
const acks = (r: AckRecord = record()) => new Map([[r.rowKey, r]]);
const staff = new Map([["user-1", "dana@example.test"]]);

const bodyRows = () => within(screen.getAllByRole("table")[0]).getAllByRole("row").slice(1);
const names = () => bodyRows().map((r) => within(r).getAllByRole("link")[0].textContent);
const rowOf = (name: string) => bodyRows().find((r) => within(r).queryByRole("link", { name })) as HTMLElement;
const chip = (name: RegExp | string) => within(screen.getByRole("navigation", { name: "Filter" })).getByRole("link", { name });

describe("BillingOverview with acknowledgements", () => {
  it("leaves an acknowledged row out of the list, the counts and the dollars at stake, and keeps a quiet line about it", () => {
    render(<BillingOverview overview={overview(schedules())} acknowledgements={acks()} staff={staff} />);
    expect(names()).toEqual(["Bea Example"]);
    expect(screen.getByTestId("issue-totals")).toHaveTextContent("1 issue for 1 member, $47.00 at stake");
    expect(screen.getByTestId("acknowledged-totals")).toHaveTextContent("1 acknowledged, $697.00, left out of the count above.");
    expect(chip(/^All \(1\)$/)).toBeInTheDocument();
    expect(chip(/Event, program and course purchases \(0\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show acknowledged" })).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation?ack=1");
  });

  it("has no acknowledged line when nothing is acknowledged", () => {
    render(<BillingOverview overview={overview(schedules())} />);
    expect(screen.queryByTestId("acknowledged-totals")).not.toBeInTheDocument();
    expect(screen.getByTestId("issue-totals")).toHaveTextContent("2 issues for 2 members, $744.00 at stake");
  });

  it("shows acknowledged rows last and muted when asked, still not counted as needing a look", () => {
    render(<BillingOverview overview={overview(schedules())} acknowledgements={acks()} staff={staff} ack="1" />);
    expect(names()).toEqual(["Bea Example", "Ada Example"]);
    const settled = bodyRows()[1];
    expect(settled).toHaveAttribute("data-acknowledged", "true");
    expect(within(settled).getByText("Acknowledged: Complimentary")).toBeInTheDocument();
    expect(screen.getByTestId("issue-totals")).toHaveTextContent("1 issue for 1 member, $47.00 at stake");
    expect(screen.getByTestId("acknowledged-totals")).toHaveTextContent("1 acknowledged, $697.00");
    expect(screen.getByRole("link", { name: "Hide acknowledged" })).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation");
  });

  it("keeps the choice in the links of the filters while acknowledged rows are shown", () => {
    render(<BillingOverview overview={overview(schedules())} acknowledgements={acks()} staff={staff} ack="1" hub="active" />);
    expect(chip(/^Collect money/)).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation?filter=collect&hub=active&ack=1");
  });

  it("brings a row back, saying it changed, when the status or the amount is no longer what staff saw", async () => {
    render(<BillingOverview overview={overview(schedules("missing_payment", 99700))} acknowledgements={acks()} staff={staff} />);
    expect(names().sort()).toEqual(["Ada Example", "Bea Example"]);
    expect(screen.getByTestId("issue-totals")).toHaveTextContent("2 issues for 2 members, $1,044.00 at stake");
    expect(screen.queryByTestId("acknowledged-totals")).not.toBeInTheDocument();
    const ada = bodyRows().find((r) => within(r).queryByRole("link", { name: "Ada Example" })) as HTMLElement;
    expect(ada).not.toHaveAttribute("data-acknowledged");
    expect(within(ada).getByText("Marked complimentary, changed since")).toBeInTheDocument();
    await userEvent.click(within(ada).getByRole("button", { name: /Show details/ }));
    expect(screen.getByText("Was marked complimentary on 2026-05-30, but it has changed since.")).toBeInTheDocument();
  });

  it("says nothing is left when everything is acknowledged", () => {
    const only: PurchaseSchedule[] = [schedules()[0]];
    render(<BillingOverview overview={overview(only)} acknowledgements={acks()} staff={staff} />);
    expect(screen.getByText("Nothing is left to look at.")).toBeInTheDocument();
    expect(screen.getByTestId("acknowledged-totals")).toHaveTextContent("1 acknowledged");
  });

  it("finds an acknowledged row by its reason or note in the search", async () => {
    render(<BillingOverview overview={overview(schedules())} acknowledgements={acks()} staff={staff} ack="1" />);
    await userEvent.type(screen.getByRole("searchbox"), "promised");
    expect(names()).toEqual(["Ada Example"]);
  });

  it("shows the decision to everyone, and the controls only to who may acknowledge", async () => {
    const { unmount } = render(<BillingOverview overview={overview(schedules())} acknowledgements={acks()} staff={staff} ack="1" />);
    await userEvent.click(within(rowOf("Ada Example")).getByRole("button", { name: /Show details/ }));
    expect(screen.getByTestId("ack-summary")).toHaveTextContent("Complimentary Marked by dana@example.test on 2026-05-30.");
    expect(screen.getByText("Seed launch, promised")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    unmount();

    render(<BillingOverview overview={overview(schedules())} acknowledgements={acks()} staff={staff} ack="1" canAcknowledge />);
    await userEvent.click(within(rowOf("Bea Example")).getByRole("button", { name: /Show details/ }));
    expect(screen.getByRole("button", { name: "Mark as…" })).toBeInTheDocument();
    await userEvent.click(within(rowOf("Ada Example")).getByRole("button", { name: /Show details/ }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark again as…" })).toBeInTheDocument();
  });
});
