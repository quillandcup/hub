import { describe, expect, it } from "vitest";
import { pickStripeCustomerByEmail } from "@/lib/stripe-customer-link";

const identity = (e: string) => e.toLowerCase();
const older = { stripe_customer_id: "cus_AAAAAAAAAAAA01", email: "member1@example.com", created_at_stripe: "2022-01-01T00:00:00Z" };
const newer = { stripe_customer_id: "cus_AAAAAAAAAAAA02", email: "member1@example.com", created_at_stripe: "2024-01-01T00:00:00Z" };

describe("pickStripeCustomerByEmail", () => {
  it("prefers the customer with the live subscription over a newer empty one, in either input order", () => {
    const subs = [{ stripe_customer_id: older.stripe_customer_id, status: "active" }];
    expect(pickStripeCustomerByEmail([older, newer], subs, identity).get("member1@example.com")).toBe(older.stripe_customer_id);
    expect(pickStripeCustomerByEmail([newer, older], subs, identity).get("member1@example.com")).toBe(older.stripe_customer_id);
  });

  it.each(["active", "trialing", "past_due"])("counts %s as live", (status) => {
    const subs = [
      { stripe_customer_id: older.stripe_customer_id, status },
      { stripe_customer_id: newer.stripe_customer_id, status: "canceled" },
    ];
    expect(pickStripeCustomerByEmail([newer, older], subs, identity).get("member1@example.com")).toBe(older.stripe_customer_id);
  });

  it("counts a paused subscription as a subscription but not as live", () => {
    const subs = [
      { stripe_customer_id: older.stripe_customer_id, status: "paused" },
      { stripe_customer_id: newer.stripe_customer_id, status: "active" },
    ];
    expect(pickStripeCustomerByEmail([older, newer], subs, identity).get("member1@example.com")).toBe(newer.stripe_customer_id);
  });

  it("falls back to a customer with any subscription, then the newest", () => {
    const withCanceled = [{ stripe_customer_id: older.stripe_customer_id, status: "canceled" }];
    expect(pickStripeCustomerByEmail([newer, older], withCanceled, identity).get("member1@example.com")).toBe(older.stripe_customer_id);
    expect(pickStripeCustomerByEmail([older, newer], [], identity).get("member1@example.com")).toBe(newer.stripe_customer_id);
    expect(pickStripeCustomerByEmail([newer, older], [], identity).get("member1@example.com")).toBe(newer.stripe_customer_id);
  });

  it("breaks a full tie by customer id, whatever the order", () => {
    const a = { ...older, created_at_stripe: null };
    const b = { ...newer, created_at_stripe: null };
    expect(pickStripeCustomerByEmail([a, b], [], identity).get("member1@example.com")).toBe(b.stripe_customer_id);
    expect(pickStripeCustomerByEmail([b, a], [], identity).get("member1@example.com")).toBe(b.stripe_customer_id);
  });

  it("groups by the alias-resolved email and skips customers without an email", () => {
    const alias = { stripe_customer_id: "cus_AAAAAAAAAAAA03", email: "ada.alias@example.com", created_at_stripe: "2023-01-01T00:00:00Z" };
    const noEmail = { stripe_customer_id: "cus_AAAAAAAAAAAA04", email: null, created_at_stripe: null };
    const resolve = (e: string) => (e === "ada.alias@example.com" ? "member1@example.com" : e);
    const subs = [{ stripe_customer_id: alias.stripe_customer_id, status: "active" }];
    const result = pickStripeCustomerByEmail([older, newer, alias, noEmail], subs, resolve);
    expect(result.get("member1@example.com")).toBe(alias.stripe_customer_id);
    expect(result.size).toBe(1);
  });
});
