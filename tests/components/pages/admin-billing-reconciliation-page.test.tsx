// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
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
    await renderServerPage(BillingReconciliationPage, {});
    expect(guard).toHaveBeenCalledWith("billing.reconciliation.read");
  });

  it("says so when no invoices are imported", async () => {
    repos = createInMemoryRepos();
    await renderServerPage(BillingReconciliationPage, {});
    expect(screen.getByText(/No Stripe invoices are imported yet/)).toBeInTheDocument();
  });

  it("lists the members with a row that needs a look, by display name, linking to their Transactions tab", async () => {
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
    await renderServerPage(BillingReconciliationPage, {});
    expect(screen.getByRole("link", { name: "Bea Example" })).toHaveAttribute("href", `/admin/members/${BEA}/transactions`);
    expect(screen.queryByRole("link", { name: "Ada E." })).not.toBeInTheDocument();
    expect(screen.getByText("Missed: 2")).toBeInTheDocument();
    expect(screen.getByText("Members who need a look").parentElement).toHaveTextContent("1");
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
    await renderServerPage(BillingReconciliationPage, {});
    expect(screen.getByText("Every billing day lines up.")).toBeInTheDocument();
  });
});
