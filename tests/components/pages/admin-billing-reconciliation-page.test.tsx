// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { useFakeClock } from "@/tests/helpers/fake-clock";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
const guard = vi.hoisted(() => vi.fn(async (_permission: string) => undefined));
vi.mock("@/lib/admin-auth", () => ({ requirePermission: guard }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => repos }));

import BillingReconciliationPage from "@/app/(admin)/admin/hygiene/billing-reconciliation/page";

const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const sub = (id: string, customer: string) => ({ stripe_subscription_id: id, stripe_customer_id: customer, status: "active", created_at_stripe: "2026-03-09T15:00:00Z", data: {} });
const invoice = (id: string, customer: string, createdAt: string) => ({
  stripe_invoice_id: id, stripe_customer_id: customer, stripe_product_id: "prod_m", status: "paid", amount_paid: 4700, amount_due: 4700, created_at_stripe: createdAt,
});

beforeEach(() => {
  resetServerPageMocks();
  guard.mockClear();
});
afterEach(cleanup);

describe("billing reconciliation page", () => {
  useFakeClock(() => Date.parse("2026-05-20T16:00:00Z"));

  it("asks for its own permission first", async () => {
    repos = createInMemoryRepos();
    await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({}) });
    expect(guard).toHaveBeenCalledWith("billing.reconciliation.read");
  });

  it("says so when no invoices are imported", async () => {
    repos = createInMemoryRepos();
    await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({}) });
    expect(screen.getByText(/No Stripe invoices are imported yet/)).toBeInTheDocument();
  });

  it("lists a row per issue, by name, linking to the member's Transactions tab", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: ADA, name: "Ada Example", displayName: "Ada E.", email: "ada@example.test", status: "active", stripeCustomerId: "cus_ada" },
          { id: BEA, name: "Bea Example", email: "bea@example.test", status: "active", stripeCustomerId: "cus_bea" },
        ],
        stripeProducts: [{ stripe_product_id: "prod_m", name: "Quill & Cup Membership" }],
        stripeSubscriptions: [sub("sub_a", "cus_ada"), sub("sub_b", "cus_bea")],
        stripeInvoices: [
          invoice("in_a1", "cus_ada", "2026-03-09T15:00:00Z"),
          invoice("in_a2", "cus_ada", "2026-04-09T15:00:00Z"),
          invoice("in_a3", "cus_ada", "2026-05-09T15:00:00Z"),
          invoice("in_b1", "cus_bea", "2026-03-09T15:00:00Z"),
        ],
      } as never)
    );
    await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({}) });
    // Bea missed April and May: two issues, one row each, for the one member.
    const links = screen.getAllByRole("link", { name: "Bea Example" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", `/admin/members/${BEA}/transactions`);
    expect(screen.queryByRole("link", { name: "Ada E." })).not.toBeInTheDocument();
    // The sentence is behind the row's disclosure button.
    expect(screen.queryByText(/Billing was due on 2026-04-09/)).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /Show details for Bea Example: Missed/ })[0]);
    expect(screen.getByText(/Billing was due on 2026-04-09/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs a look: All" })).toBeInTheDocument();
    expect(screen.getByTestId("issue-totals")).toHaveTextContent("2 issues for 1 member, $94.00 at stake");
  });

  it("congratulates when every billing day lines up", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [{ id: ADA, name: "Ada Example", email: "ada@example.test", status: "active", stripeCustomerId: "cus_ada" }],
        stripeProducts: [{ stripe_product_id: "prod_m", name: "Quill & Cup Membership" }],
        stripeSubscriptions: [sub("sub_a", "cus_ada")],
        stripeInvoices: [invoice("in_a1", "cus_ada", "2026-03-09T15:00:00Z"), invoice("in_a2", "cus_ada", "2026-04-09T15:00:00Z"), invoice("in_a3", "cus_ada", "2026-05-09T15:00:00Z")],
      } as never)
    );
    await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({}) });
    expect(screen.getByText("Every billing day lines up.")).toBeInTheDocument();
  });

  describe("unpaid invoices", () => {
    beforeEach(() => {
      const open = (id: string, customer: string, createdAt: string) => ({ ...invoice(id, customer, createdAt), status: "open", amount_paid: 0, attempt_count: 0 });
      repos = createInMemoryRepos(
        new InMemoryDataset({
          members: [
            { id: ADA, name: "Ada Example", email: "ada@example.test", status: "active", stripeCustomerId: "cus_ada" },
            { id: BEA, name: "Bea Example", email: "bea@example.test", status: "active", stripeCustomerId: "cus_bea" },
          ],
          stripeProducts: [{ stripe_product_id: "prod_m", name: "Quill & Cup Membership" }],
          stripeSubscriptions: [{ ...sub("sub_a", "cus_ada"), data: { collection_method: "send_invoice" } }, sub("sub_b", "cus_bea")],
          stripeInvoices: [
            // Ada: paid in March, then two open invoices and nothing since (behind).
            { ...invoice("in_a1", "cus_ada", "2026-03-09T15:00:00Z"), stripe_subscription_id: "sub_a" },
            { ...open("in_a2", "cus_ada", "2026-04-09T15:00:00Z"), stripe_subscription_id: "sub_a" },
            { ...open("in_a3", "cus_ada", "2026-05-09T15:00:00Z"), stripe_subscription_id: "sub_a" },
            // Bea: March open, paid in April and May (paying again).
            open("in_b1", "cus_bea", "2026-03-09T15:00:00Z"),
            invoice("in_b2", "cus_bea", "2026-04-09T15:00:00Z"),
            invoice("in_b3", "cus_bea", "2026-05-09T15:00:00Z"),
          ],
        } as never)
      );
    });

    it("shows one row per unpaid run, the two kinds counted as rows, and the invoice-sent wording", async () => {
      await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({}) });
      const filter = within(screen.getByRole("navigation", { name: "Filter" }));
      expect(filter.getByRole("link", { name: "Collect money (2)" })).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation?filter=collect");
      expect(filter.getByRole("link", { name: "All (2)" })).toHaveAttribute("aria-current", "page");
      // Ada is behind on two emailed invoices ($94.00 since April); Bea pays again but March was never collected ($47.00).
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByRole("link", { name: "Ada Example" })).toHaveAttribute("href", `/admin/members/${ADA}/transactions`);
      expect(within(rows[0]).getByText("Unpaid, behind")).toBeInTheDocument();
      expect(within(rows[0]).getByText("$94.00")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Unpaid earlier, paying again")).toBeInTheDocument();
      await userEvent.click(within(rows[0]).getByRole("button", { name: /Show details/ }));
      expect(screen.getByText(/2 invoices unpaid since 2026-04-09, \$94.00 total/)).toBeInTheDocument();
      expect(screen.getByText(/never charges a card/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "in_a2" })).toHaveAttribute("href", "https://dashboard.stripe.com/invoices/in_a2");
    });

    it("narrows to each kind with the old filter ids", async () => {
      await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({ filter: "paying_again" }) });
      expect(screen.getByRole("link", { name: "Bea Example" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Ada Example" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /Show details/ }));
      expect(screen.getByText(/The member is paying again/)).toBeInTheDocument();
      cleanup();
      await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({ filter: "behind" }) });
      expect(screen.getByRole("link", { name: "Ada Example" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Bea Example" })).not.toBeInTheDocument();
    });
  });

  describe("filters", () => {
    beforeEach(() => {
      repos = createInMemoryRepos(
        new InMemoryDataset({
          members: [
            { id: ADA, name: "Ada Example", email: "ada@example.test", status: "active", stripeCustomerId: "cus_ada" },
            { id: BEA, name: "Bea Example", email: "bea@example.test", status: "active", stripeCustomerId: "cus_bea" },
          ],
          stripeProducts: [{ stripe_product_id: "prod_m", name: "Quill & Cup Membership" }],
          stripeSubscriptions: [sub("sub_a", "cus_ada"), sub("sub_b", "cus_bea")],
          stripeInvoices: [
            invoice("in_a1", "cus_ada", "2026-03-09T15:00:00Z"),
            invoice("in_a2", "cus_ada", "2026-04-09T15:00:00Z"),
            invoice("in_a3", "cus_ada", "2026-05-09T15:00:00Z"),
            invoice("in_b1", "cus_bea", "2026-03-09T15:00:00Z"),
          ],
          memberHiatuses: [{ id: "hia_AAAAAAAAAAA1", member_id: ADA, start_date: "2026-04-01", end_date: "2026-04-30", reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-04-01T00:00:00Z" }],
        } as never)
      );
    });

    it("narrows to the charged-during-a-hiatus rows, with the counts on every chip", async () => {
      await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({ filter: "charged_hiatus" }) });
      expect(screen.getByRole("link", { name: "Ada Example" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Bea Example" })).not.toBeInTheDocument();
      const filter = within(screen.getByRole("navigation", { name: "Filter" }));
      expect(filter.getByRole("link", { name: "Hiatus and program billing (1)" })).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation?filter=hiatus");
      expect(filter.getByRole("link", { name: "Collect money (2)" })).toBeInTheDocument();
      expect(filter.getByRole("link", { name: "All (3)" })).toHaveAttribute("href", "/admin/hygiene/billing-reconciliation");
    });

    it("narrows by Hub status from the URL", async () => {
      await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({ hub: "cancelled" }) });
      expect(screen.getByText("Nothing here.")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Hub status" })).toHaveValue("cancelled");
    });

    it("says nothing is there for an empty filter, and falls back to all for an unknown one", async () => {
      await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({ filter: "missed_after_hiatus" }) });
      expect(screen.getByText("Nothing here.")).toBeInTheDocument();
      cleanup();
      await renderServerPage(BillingReconciliationPage, { searchParams: Promise.resolve({ filter: "nonsense" }) });
      expect(screen.getByRole("link", { name: "All (3)" })).toHaveAttribute("aria-current", "page");
    });
  });
});
