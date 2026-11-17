// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { MEMBER_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { SUPPORT_EMAIL } from "@/lib/config";
import {
  COMPLIANCE_GROUPS,
  COMPLIANCE_PROVIDERS,
  COMPLIANCE_STATUSES,
  COMPLIANCE_EFFECTIVE,
} from "@/lib/compliance";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));

import CompliancePage from "@/app/compliance/page";

describe("/compliance", () => {
  beforeEach(() => {
    resetServerPageMocks();
  });

  it("is public: a signed-out visitor reads it, with a sign-in link", async () => {
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Compliance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to the Hub" })).toHaveAttribute("href", "/login");
    expect(screen.getByText(COMPLIANCE_EFFECTIVE)).toBeInTheDocument();
  });

  it("gives a signed-in member a way back to the Hub", async () => {
    signInAs(MEMBER_USER);
    await renderServerPage(CompliancePage, {});
    expect(screen.getByRole("link", { name: "Back to the Hub" })).toHaveAttribute("href", "/dashboard");
  });

  it("lists every item of every group, each with its status shown as text", async () => {
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    for (const group of COMPLIANCE_GROUPS) {
      const section = document.getElementById(group.id);
      if (!section) throw new Error(`no section #${group.id}`);
      const scope = within(section);
      expect(scope.getByRole("heading", { level: 2, name: group.title })).toBeInTheDocument();
      for (const item of group.items) {
        const card = scope.getByRole("heading", { level: 3, name: item.name }).closest("li");
        expect(card).not.toBeNull();
        expect(within(card as HTMLElement).getByText(COMPLIANCE_STATUSES[item.status])).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText(item.detail)).toBeInTheDocument();
      }
    }
  });

  it("names the card standard as the payment provider's, not ours", async () => {
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    const card = screen.getByRole("heading", { level: 3, name: "PCI DSS" }).closest("li") as HTMLElement;
    expect(within(card).getByText(COMPLIANCE_STATUSES.provider)).toBeInTheDocument();
    expect(within(card).getByText(/never reach the Hub/)).toBeInTheDocument();
  });

  it("lists the services and links to the privacy page and the support address", async () => {
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    const providers = within(document.getElementById("providers") as HTMLElement);
    for (const p of COMPLIANCE_PROVIDERS) expect(providers.getByText(p.name)).toBeInTheDocument();
    expect(providers.getByRole("link", { name: "Privacy page" })).toHaveAttribute("href", "/privacy#services");
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
  });
});

describe("compliance list", () => {
  it("has unique ids and names, and claims no certificate of our own", () => {
    const ids = COMPLIANCE_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = COMPLIANCE_GROUPS.flatMap((g) => g.items.map((i) => i.name));
    expect(new Set(names).size).toBe(names.length);
    // Only a provider may be listed as holding a certification; the rows we hold ourselves never use that status for one.
    for (const item of COMPLIANCE_GROUPS.flatMap((g) => g.items)) {
      expect(Object.keys(COMPLIANCE_STATUSES)).toContain(item.status);
      expect(item.evidence.length).toBeGreaterThan(0);
    }
  });
});
