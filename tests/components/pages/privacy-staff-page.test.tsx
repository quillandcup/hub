// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerPage } from "@/tests/helpers/server-page";
import { COMPLIANCE_STATUSES } from "@/lib/compliance";
import { PRIVACY_GROUPS } from "@/lib/privacy-promises";
import { RETENTION } from "@/lib/retention";
import { SUPPORT_EMAIL } from "@/lib/config";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));

const requireAdminPage = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

import AdminPrivacyPage from "@/app/(admin)/admin/privacy/page";
import { containsText } from "@/tests/helpers/contains-text";

const ROWS = PRIVACY_GROUPS.flatMap((g) => g.rows);

describe("/admin/privacy (staff)", () => {
  beforeEach(() => {
    requireAdminPage.mockReset();
    requireAdminPage.mockResolvedValue({ id: "admin" });
  });

  it("checks for an admin first and renders nothing when the check redirects", async () => {
    requireAdminPage.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(AdminPrivacyPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(requireAdminPage).toHaveBeenCalledTimes(1);
  });

  it("links to the public Privacy page and has a section for each group, with only its own rows", async () => {
    await renderServerPage(AdminPrivacyPage, {});
    expect(screen.getAllByRole("link", { name: "Privacy page" }).map((a) => a.getAttribute("href"))).toContain("/privacy");
    for (const group of PRIVACY_GROUPS) {
      const section = document.getElementById(group.id) as HTMLElement;
      expect(within(section).getByRole("heading", { level: 2, name: group.title })).toBeInTheDocument();
      for (const row of group.rows) expect(within(section).getByRole("heading", { level: 3, name: row.title })).toBeInTheDocument();
      for (const row of ROWS.filter((r) => !group.rows.includes(r))) {
        expect(within(section).queryByRole("heading", { level: 3, name: row.title })).not.toBeInTheDocument();
      }
    }
  });

  it("shows every promise with its status, how it is kept, where, the check date and open items", async () => {
    await renderServerPage(AdminPrivacyPage, {});
    for (const row of ROWS) {
      const card = document.getElementById(row.id) as HTMLElement;
      expect(card).not.toBeNull();
      expect(within(card).getByText(COMPLIANCE_STATUSES[row.status])).toBeInTheDocument();
      expect(within(card).getByText(containsText(row.member))).toBeInTheDocument();
      expect(within(card).getByText(containsText(row.how))).toBeInTheDocument();
      for (const where of row.evidence) expect(within(card).getByText(where)).toBeInTheDocument();
      expect(within(card).getByText(row.checked)).toBeInTheDocument();
      for (const text of row.open) expect(within(card).getByText(containsText(text))).toBeInTheDocument();
    }
  });

  it("counts the open items and links each to its row", async () => {
    await renderServerPage(AdminPrivacyPage, {});
    const total = ROWS.reduce((n, r) => n + r.open.length, 0);
    expect(total).toBeGreaterThan(0);
    const box = screen.getByRole("heading", { level: 2, name: `Still open (${total})` }).closest("aside") as HTMLElement;
    const first = ROWS.find((r) => r.open.length > 0)!;
    const entry = within(box).getByText(containsText(first.open[0])).closest("li") as HTMLElement;
    expect(within(entry).getByRole("link", { name: first.title })).toHaveAttribute("href", `#${first.id}`);
  });
});

describe("privacy promises list", () => {
  it("has unique ids and dated, evidenced rows", () => {
    const ids = ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of ROWS) {
      expect(row.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.evidence.length).toBeGreaterThan(0);
    }
  });

  it("states the retention limits from the same constants the page and the nightly job use", () => {
    const network = ROWS.find((r) => r.id === "retention-network")!;
    const usage = ROWS.find((r) => r.id === "retention-usage")!;
    expect(network.title).toContain(`${RETENTION.rawNetworkDays} days`);
    expect(network.member).toContain(`${RETENTION.rawNetworkDays} days`);
    expect(usage.title).toContain(`${RETENTION.usageMonths} months`);
    expect(usage.member).toContain(`${RETENTION.usageMonths} months`);
  });

  it("keeps the public-repo rule: no emails, links or key-shaped strings", () => {
    // The support address is public config the page shows members; nothing else may look like an email.
    const text = JSON.stringify(PRIVACY_GROUPS).replaceAll(SUPPORT_EMAIL, "");
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\b(sk|pk|xox[bp])[-_][A-Za-z0-9]{8,}/);
  });
});

describe("the data-requests row", () => {
  const rights = ROWS.find((r) => r.id === "rights")!;

  it("names the staff removal tool and points at the files that do it", async () => {
    expect(rights.how).toContain("Remove on request");
    const { existsSync } = await import("node:fs");
    for (const where of rights.evidence.filter((e) => /\.(tsx?|sql)$/.test(e))) expect(existsSync(where), where).toBe(true);
  });

  it("does not say there is no tool for requests, and keeps what is really missing open", () => {
    expect(rights.open.join(" ")).not.toMatch(/no in-app tool or queue/);
    expect(rights.open.join(" ")).toMatch(/one-month deadline/);
  });
});
