// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/hygiene/billing-reconciliation",
  useSearchParams: () => new URLSearchParams(),
}));

import BillingOverview from "@/app/(admin)/admin/hygiene/billing-reconciliation/BillingOverview";
import type { BillingOverview as Overview } from "@/lib/billing-reconciliation-loader";
import type { PurchaseSchedule, ScheduleRow, ScheduleTransaction } from "@/lib/billing-reconciliation";

afterEach(() => {
  cleanup();
  nav.push.mockClear();
});

const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const CY = "mbr_AAAAAAAAAAA3";

const tx = (id: string, day: string, extra: Partial<ScheduleTransaction> = {}): ScheduleTransaction => ({
  invoiceId: id,
  chargeIds: [],
  day,
  billedCents: 4700,
  keptCents: 0,
  refundedCents: 0,
  invoiceStatus: "open",
  failureCodes: [],
  attempts: 0,
  ...extra,
});
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
const membership = (memberId: string, rows: ScheduleRow[]): PurchaseSchedule => ({ purchaseType: "membership", label: "Membership", key: `${memberId}:membership`, memberId, start: null, end: null, notes: [], rows });
const eventSchedule = (memberId: string, rows: ScheduleRow[]): PurchaseSchedule => ({
  purchaseType: "event",
  label: "Spring Retreat",
  key: `${memberId}:event:evt_1:p1`,
  memberId,
  start: "2026-02-01",
  end: null,
  rows,
  notes: [],
  event: { id: "evt_1", slug: "spring-retreat", title: "Spring Retreat" },
  purchase: { purchaseId: "p1", offerName: "Spring Retreat ticket", priceText: "$500.00 one time", day: "2026-02-01", amountCents: 50000, quantity: 1, granted: false, status: "active" },
});

const overview = (schedules: PurchaseSchedule[], extra: Partial<Overview> = {}): Overview => ({
  schedules,
  members: new Map([
    [ADA, { id: ADA, name: "Ada Example", displayName: "Ada E.", status: "active" }],
    [BEA, { id: BEA, name: "Bea Example", displayName: null, status: "active" }],
    [CY, { id: CY, name: "Cy Example", displayName: null, status: "on_hiatus" }],
  ]),
  today: "2026-06-01",
  counts: { linkedMembers: 3, invoices: 9, charges: 0, subscriptions: 3, purchases: 1, unrecognisedKajabiCharges: 0 },
  ...extra,
});

/** Ada is behind on two invoices ($94), Bea missed a month ($47) and pays again after an unpaid one ($47), Cy was charged in a hiatus ($47) and disagrees with Stripe, and Ada has an unpaid retreat. */
const schedules = (): PurchaseSchedule[] => [
  membership(ADA, [
    row("ada:behind", "unpaid_behind", { expectedDate: "2026-04-09", expectedAmountCents: 9400, transactions: [tx("in_a2", "2026-04-09"), tx("in_a3", "2026-05-09", { invoiceStatus: "uncollectible", attempts: 2, failureCodes: ["card_declined"] })] }),
  ]),
  membership(BEA, [
    row("bea:missed", "missed", { expectedDate: "2026-05-09", expectedAmountCents: 4700 }),
    row("bea:again", "unpaid_earlier", { expectedDate: "2026-03-09", expectedAmountCents: 4700, transactions: [tx("in_b1", "2026-03-09", { attempts: 1 })] }),
    row("bea:unexpected", "unexpected", { transactions: [tx("in_b9", "2026-05-30", { invoiceStatus: "paid", keptCents: 4700, attempts: 1 })], expectedAmountCents: null }),
  ]),
  membership(CY, [
    row("cy:charged", "charged_when_not_expected", { cause: "hiatus", expectedDate: "2026-05-20", transactions: [tx("in_c1", "2026-05-20", { invoiceStatus: "paid", keptCents: 4700, attempts: 1 })] }),
    row("cy:disagree", "hub_stripe_disagree", { cause: "hiatus" }),
  ]),
  eventSchedule(ADA, [row("ada:event", "missing_payment", { expectedDate: "2026-02-01", expectedAmountCents: 50000 }), row("ada:granted", "granted_no_override", { cause: "granted" })]),
];

const issueTable = () => screen.getAllByRole("table")[0];
const bodyRows = () => within(issueTable()).getAllByRole("row").slice(1);
const memberLinks = () => bodyRows().map((r) => within(r).getAllByRole("link")[0].textContent);
const chip = (name: RegExp | string) => within(screen.getByRole("navigation", { name: "Filter" })).getByRole("link", { name });

describe("BillingOverview table", () => {
  it("shows one row per issue (not per member), with member, purchase, issue, amount, age and Hub status", () => {
    render(<BillingOverview overview={overview(schedules())} />);
    expect(bodyRows()).toHaveLength(8);
    const first = bodyRows()[0];
    expect(within(first).getByRole("link", { name: "Ada E." })).toHaveAttribute("href", `/admin/members/${ADA}/transactions`);
    expect(within(first).getByText("Ada Example")).toBeInTheDocument();
    expect(within(first).getByText("Membership")).toBeInTheDocument();
    expect(within(first).getByText("Unpaid, behind")).toBeInTheDocument();
    expect(within(first).getByText("$94.00")).toBeInTheDocument();
    expect(within(first).getByText("53 days")).toBeInTheDocument();
    expect(within(first).getByText("since 2026-04-09")).toBeInTheDocument();
    expect(within(first).getByText("Active")).toBeInTheDocument();
    // The event row links the event page; the legal name only shows where it differs.
    const eventRow = bodyRows().find((r) => within(r).queryByRole("link", { name: "Spring Retreat" }));
    expect(within(eventRow as HTMLElement).getByRole("link", { name: "Spring Retreat" })).toHaveAttribute("href", "/admin/events/spring-retreat");
    expect(within(eventRow as HTMLElement).getByText("Spring Retreat ticket")).toBeInTheDocument();
    expect(screen.queryByText("Bea Example", { selector: "span" })).not.toBeInTheDocument();
  });

  it("starts in urgency order: behind first, then the largest amount, then the oldest", () => {
    render(<BillingOverview overview={overview(schedules())} />);
    // Ada behind $94; then the $500 retreat (Ada); then $47 rows, oldest first (Bea paying again since 03-09, Bea missed 05-09, Cy 05-20, Bea unexpected 05-30); then rows with no amount.
    expect(memberLinks()).toEqual(["Ada E.", "Ada E.", "Bea Example", "Bea Example", "Cy Example", "Bea Example", "Ada E.", "Cy Example"]);
    expect(within(bodyRows()[1]).getByText("Missing payment")).toBeInTheDocument();
  });

  it("sorts every column both ways, amount and age by value", async () => {
    const user = userEvent.setup();
    render(<BillingOverview overview={overview(schedules())} />);
    const th = (name: string) => within(issueTable()).getByRole("columnheader", { name: new RegExp(`^${name}`) });
    const amounts = () => bodyRows().map((r) => within(r).queryAllByRole("cell")[4].textContent);
    const ages = () => bodyRows().map((r) => within(r).queryAllByRole("cell")[5].textContent);

    await user.click(within(th("Amount")).getByRole("button"));
    // Ascending: 47.00 rows, then 94.00, then 500.00 (a text sort would put $500.00 before $94.00), blanks last.
    expect(amounts()).toEqual(["$47.00", "$47.00", "$47.00", "$47.00", "$94.00", "$500.00", "", ""]);
    await user.click(within(th("Amount")).getByRole("button"));
    expect(amounts()).toEqual(["", "", "$500.00", "$94.00", "$47.00", "$47.00", "$47.00", "$47.00"]);

    await user.click(within(th("Age")).getByRole("button"));
    const ascending = ages().filter((a) => a.includes("day"));
    expect(ascending.map((a) => Number.parseInt(a, 10))).toEqual([...ascending.map((a) => Number.parseInt(a, 10))].sort((a, b) => a - b));
    expect(ascending[0]).toMatch(/^2 days/);
    expect(ascending.at(-1)).toMatch(/^120 days/);
    await user.click(within(th("Age")).getByRole("button"));
    expect(ages().filter((a) => a.includes("day"))[0]).toMatch(/^120 days/);

    await user.click(within(th("Member")).getByRole("button"));
    expect(memberLinks()[0]).toBe("Ada E.");
    expect(memberLinks().at(-1)).toBe("Cy Example");
    await user.click(within(th("Member")).getByRole("button"));
    expect(memberLinks()[0]).toBe("Cy Example");

    await user.click(within(th("Issue")).getByRole("button"));
    expect(within(bodyRows()[0]).getByText("Charged when it should not be")).toBeInTheDocument();
    await user.click(within(th("Purchase")).getByRole("button"));
    expect(within(bodyRows()[0]).getByText("Membership")).toBeInTheDocument();
    await user.click(within(th("Hub status")).getByRole("button"));
    expect(within(bodyRows()[0]).getByText("Active")).toBeInTheDocument();
    await user.click(within(th("Hub status")).getByRole("button"));
    expect(within(bodyRows()[0]).getByText("On hiatus")).toBeInTheDocument();
  });

  it("searches the member, the issue and the reason, every word having to appear", async () => {
    const user = userEvent.setup();
    render(<BillingOverview overview={overview(schedules())} />);
    const box = screen.getByRole("searchbox");
    await user.type(box, "bea");
    expect(memberLinks()).toEqual(["Bea Example", "Bea Example", "Bea Example"]);
    await user.clear(box);
    await user.type(box, "reason cy:disagree");
    expect(memberLinks()).toEqual(["Cy Example"]);
    await user.clear(box);
    await user.type(box, "ada example missing");
    expect(bodyRows()).toHaveLength(1);
    await user.clear(box);
    await user.type(box, "granted");
    expect(bodyRows()).toHaveLength(1);
  });
});

describe("BillingOverview filters", () => {
  it("has a handful of group chips, each counting rows, and a Hub status select beside them", () => {
    render(<BillingOverview overview={overview(schedules())} />);
    const nav = screen.getByRole("navigation", { name: "Filter" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "All (8)",
      "Collect money (3)",
      "Hiatus and program billing (1)",
      "Hub and Stripe disagree (1)",
      "Event, program and course purchases (2)",
      "Unexpected payments (1)",
    ]);
    expect(chip("All (8)")).toHaveAttribute("aria-current", "page");
    expect(chip("Collect money (3)")).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation?filter=collect");
    expect(screen.getByRole("combobox", { name: "Hub status" })).toHaveValue("all");
    expect(within(screen.getByRole("combobox", { name: "Hub status" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Any Hub status (8)", "Active (6)", "On hiatus (2)", "Cancelled (0)"]);
  });

  it("narrows to a group and says how many issues, members and dollars are in it", () => {
    render(<BillingOverview overview={overview(schedules())} filter="collect" />);
    expect(chip("Collect money (3)")).toHaveAttribute("aria-current", "page");
    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Needs a look: Collect money" })).toBeInTheDocument();
    expect(screen.getByTestId("issue-totals")).toHaveTextContent("3 issues for 2 members, $188.00 at stake");
  });

  it("narrows by Hub status, keeps the group in the links, and the select goes to the page for its choice", async () => {
    const user = userEvent.setup();
    render(<BillingOverview overview={overview(schedules())} filter="collect" hub="active" />);
    expect(screen.getByRole("combobox", { name: "Hub status" })).toHaveValue("active");
    expect(chip("All (6)")).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation?hub=active");
    expect(chip("Hiatus and program billing (0)")).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation?filter=hiatus&hub=active");
    await user.selectOptions(screen.getByRole("combobox", { name: "Hub status" }), "hiatus");
    expect(nav.push).toHaveBeenCalledWith("/admin/hygiene/billing-reconciliation?filter=collect&hub=hiatus");
    cleanup();
    render(<BillingOverview overview={overview(schedules())} hub="hiatus" />);
    expect(memberLinks()).toEqual(["Cy Example", "Cy Example"]);
  });

  it("still understands the old filter ids, narrowing inside the groups and saying so", () => {
    const ids: [string, string[]][] = [
      ["behind", ["reason ada:behind"]],
      ["paying_again", ["reason bea:again"]],
      ["payment", ["reason ada:behind", "reason bea:again"]],
      ["missed", ["reason bea:missed"]],
      ["charged_hiatus", ["reason cy:charged"]],
      ["disagree", ["reason cy:disagree"]],
      ["unexpected", ["reason bea:unexpected"]],
      ["missing_payment", ["reason ada:event"]],
      ["granted", ["reason ada:granted"]],
    ];
    for (const [id, reasons] of ids) {
      cleanup();
      render(<BillingOverview overview={overview(schedules())} filter={id} />);
      expect(bodyRows(), id).toHaveLength(reasons.length);
    }
    cleanup();
    render(<BillingOverview overview={overview(schedules())} filter="behind" />);
    expect(screen.getByText(/Narrowed to/)).toHaveTextContent("Narrowed to “Behind: nothing paid since an unpaid invoice”");
    expect(screen.getByRole("link", { name: "Show all" })).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation");
    expect(screen.getByRole("navigation", { name: "Filter" }).querySelector("[aria-current]")).toBeNull();
  });

  it("falls back to all for an unknown filter and says nothing is there for an empty one", () => {
    render(<BillingOverview overview={overview(schedules())} filter="nonsense" />);
    expect(chip("All (8)")).toHaveAttribute("aria-current", "page");
    cleanup();
    render(<BillingOverview overview={overview(schedules())} filter="missed_after_hiatus" />);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
    cleanup();
    render(<BillingOverview overview={overview([membership(ADA, [row("ok", "paid", { needsAttention: false })])])} />);
    expect(screen.getByText("Every billing day lines up.")).toBeInTheDocument();
  });

  it("says so when no invoices are imported", () => {
    render(<BillingOverview overview={overview([], { counts: { linkedMembers: 0, invoices: 0, charges: 0, subscriptions: 0, purchases: 0, unrecognisedKajabiCharges: 0 } })} />);
    expect(screen.getByText(/No Stripe invoices are imported yet/)).toBeInTheDocument();
  });

  it("warns when charges carry Kajabi metadata in a shape the page does not recognise, and is quiet otherwise", () => {
    const counts = { linkedMembers: 3, invoices: 9, charges: 0, subscriptions: 3, purchases: 1 };
    const { unmount } = render(<BillingOverview overview={overview(schedules(), { counts: { ...counts, unrecognisedKajabiCharges: 2 } })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/2 Stripe charges have Kajabi metadata in a shape this page does not recognise/);
    unmount();
    render(<BillingOverview overview={overview(schedules(), { counts: { ...counts, unrecognisedKajabiCharges: 1 } })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/1 Stripe charge has Kajabi metadata/);
    cleanup();
    render(<BillingOverview overview={overview(schedules())} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("counts event, program and course purchases in the summary line", () => {
    render(<BillingOverview overview={overview(schedules())} />);
    expect(screen.getByText(/1 event, program and course purchases/)).toBeInTheDocument();
  });
});

describe("BillingOverview digging in", () => {
  it("opens a row to the full sentence, its transactions with Stripe links, and the member's transactions", async () => {
    const user = userEvent.setup();
    render(<BillingOverview overview={overview(schedules())} />);
    const first = bodyRows()[0];
    const toggle = within(first).getByRole("button", { name: "Show details for Ada E.: Unpaid, behind" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("reason ada:behind")).not.toBeInTheDocument();

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(within(first).getByRole("button", { name: "Hide details for Ada E.: Unpaid, behind" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("reason ada:behind")).toBeInTheDocument();
    const detail = within(screen.getByRole("table", { name: "Transactions for Ada E." }));
    expect(detail.getByRole("link", { name: "in_a2" })).toHaveAttribute("href", "https://dashboard.stripe.com/invoices/in_a2");
    expect(detail.getByRole("link", { name: "in_a3" })).toHaveAttribute("href", "https://dashboard.stripe.com/invoices/in_a3");
    expect(detail.getByText("card declined")).toBeInTheDocument();
    expect(detail.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open member's transactions" })[0]).toHaveAttribute("href", `/admin/members/${ADA}/transactions`);
    // The detail is not another row of the table.
    expect(bodyRows().filter((r) => r.hasAttribute("data-kbd-skip"))).toHaveLength(1);

    await user.keyboard(" ");
    expect(screen.queryByText("reason ada:behind")).not.toBeInTheDocument();
  });

  it("links a one-off payment to Stripe's payment page and says when no transaction is behind a row", async () => {
    const user = userEvent.setup();
    const charge = tx("ch_x", "2026-05-02", { kind: "charge", invoiceStatus: "paid", keptCents: 4700, attempts: 1 });
    render(<BillingOverview overview={overview([eventSchedule(BEA, [row("bea:charge", "unexplained_payment", { transactions: [charge] })]), membership(CY, [row("cy:none", "hub_stripe_disagree")])])} />);
    for (const button of screen.getAllByRole("button", { name: /^Show details/ })) await user.click(button);
    expect(screen.getByRole("link", { name: "ch_x" })).toHaveAttribute("href", "https://dashboard.stripe.com/payments/ch_x");
    expect(screen.getByText("No Stripe invoice or payment is behind this row.")).toBeInTheDocument();
  });
});

describe("BillingOverview paging and keys", () => {
  const many = (n: number): PurchaseSchedule[] =>
    Array.from({ length: n }, (_, i) => membership(`mbr_${String(i).padStart(11, "0")}`, [row(`m${i}`, "missed", { expectedDate: "2026-05-09", expectedAmountCents: 1000 + i })]));
  const manyOverview = (n: number) =>
    overview(many(n), { members: new Map(many(n).map((s, i) => [s.memberId, { id: s.memberId, name: `Member ${String(i).padStart(2, "0")}`, displayName: null, status: "active" }])) });

  it("pages after 50 rows with the shared pager, and counts rows, not members, in the header", async () => {
    const user = userEvent.setup();
    render(<BillingOverview overview={manyOverview(60)} />);
    expect(bodyRows()).toHaveLength(50);
    expect(screen.getByText(/Showing 1.50 of 60 issues/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(bodyRows()).toHaveLength(10);
  });

  it("moves with j and k and opens the row's member with Enter, not the disclosure button", async () => {
    const user = userEvent.setup();
    const clicked: string[] = [];
    const onClick = (e: Event) => {
      const a = (e.target as Element).closest("a");
      if (a) {
        e.preventDefault();
        clicked.push(a.getAttribute("href") ?? "");
      }
    };
    document.addEventListener("click", onClick, true);
    render(<BillingOverview overview={overview(schedules())} />);
    screen.getByRole("group", { name: "Billing issues" }).focus();
    await user.keyboard("jjj{Enter}");
    document.removeEventListener("click", onClick, true);
    expect(clicked).toEqual([`/admin/members/${BEA}/transactions`]);
    expect(document.querySelectorAll('tr[data-kbd-active="true"]')).toHaveLength(1);
  });
});
