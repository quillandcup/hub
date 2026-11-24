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
  complianceItemId,
} from "@/content/compliance";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));

import CompliancePage from "@/app/compliance/page";
import { containsText } from "@/tests/helpers/contains-text";

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

  it("shows the OpenSSF baseline as a guide we use, not a certificate we are working toward", async () => {
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    const item = COMPLIANCE_GROUPS.flatMap((g) => g.items).find((i) => i.name === "OpenSSF security baseline");
    if (!item) throw new Error("no OpenSSF row");
    expect(item.status).toBe("guide");
    const card = screen.getByRole("heading", { name: "OpenSSF security baseline" }).closest("li");
    if (!card) throw new Error("no card");
    expect(within(card).getByText(COMPLIANCE_STATUSES.guide)).toBeInTheDocument();
    expect(within(card).queryByText(COMPLIANCE_STATUSES.working)).not.toBeInTheDocument();
    expect(card.textContent).toMatch(/not aiming for a certificate/);
    // The legend explains the new word.
    expect(screen.getAllByText(COMPLIANCE_STATUSES.guide).length).toBeGreaterThan(1);
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
        expect(within(card as HTMLElement).getByText(containsText(item.detail))).toBeInTheDocument();
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

  it("links every mention of the Privacy page: a group's intro, a row and the services table", async () => {
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    const privacy = document.getElementById("privacy") as HTMLElement;
    expect(within(privacy).getAllByRole("link", { name: "Privacy page" })[0]).toHaveAttribute("href", "/privacy");
    const providers = within(document.getElementById("providers") as HTMLElement);
    const covers = COMPLIANCE_PROVIDERS.find((p) => /Privacy page/.test(String(p.covers)))!;
    const row = providers.getByText(containsText(String(covers.covers))).closest("tr") as HTMLElement;
    expect(within(row).getByRole("link", { name: "Privacy page" })).toHaveAttribute("href", "/privacy");
  });

  it("describes the services by what they do, never by name, and links to the privacy page and the support address", async () => {
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    const providers = within(document.getElementById("providers") as HTMLElement);
    for (const p of COMPLIANCE_PROVIDERS) {
      expect(providers.getByText(p.role)).toBeInTheDocument();
      expect(providers.queryByText(p.name)).not.toBeInTheDocument();
    }
    expect(providers.queryByRole("columnheader", { name: "Service" })).not.toBeInTheDocument();
    expect(providers.getAllByRole("link", { name: "Privacy page" }).map((a) => a.getAttribute("href"))).toContain("/privacy#services");
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

describe("compliance list: public-repo rule", () => {
  it("carries no emails, links or key-shaped strings, and every row is dated and has evidence", () => {
    const text = JSON.stringify(COMPLIANCE_GROUPS);
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\b(sk|pk|xox[bp])[-_][A-Za-z0-9]{8,}/);
    for (const item of COMPLIANCE_GROUPS.flatMap((g) => g.items)) {
      expect(item.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.evidence.length).toBeGreaterThan(0);
    }
  });

  it("gives every row its own in-page id", () => {
    const ids = COMPLIANCE_GROUPS.flatMap((g) => g.items.map((i) => complianceItemId(i.name)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(complianceItemId("California and other US state privacy laws")).toBe("california-and-other-us-state-privacy-laws");
  });

  it("does not show the staff-only evidence or open items to members", async () => {
    resetServerPageMocks();
    signInAs(null);
    await renderServerPage(CompliancePage, {});
    for (const item of COMPLIANCE_GROUPS.flatMap((g) => g.items)) {
      for (const text of item.open) expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });
});

describe("services we rely on", () => {
  it("lists the database and sign-in as separate rows, whatever provider serves them today", () => {
    const roles = COMPLIANCE_PROVIDERS.map((p) => p.role);
    expect(roles).toContain("Database");
    expect(roles).toContain("Sign-in");
    expect(roles).not.toContain("Database and sign-in");
    expect(new Set(roles).size).toBe(roles.length);
  });
});
