// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerPage } from "@/tests/helpers/server-page";
import { COMPLIANCE_GROUPS, COMPLIANCE_PROVIDERS, COMPLIANCE_STATUSES, complianceItemId } from "@/content/compliance";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));

const requirePermission = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/admin-auth", () => ({ requirePermission: () => requirePermission() }));

import AdminCompliancePage from "@/app/(admin)/admin/compliance/page";
import { containsText } from "@/tests/helpers/contains-text";

const ITEMS = COMPLIANCE_GROUPS.flatMap((g) => g.items);

describe("/admin/compliance (staff)", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue({ id: "admin" });
  });

  it("checks for an admin first and renders nothing when the check redirects", async () => {
    requirePermission.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(AdminCompliancePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePermission).toHaveBeenCalledTimes(1);
  });

  it("links to the public page and shows a section for each group", async () => {
    await renderServerPage(AdminCompliancePage, {});
    expect(screen.getByRole("link", { name: "Compliance page" })).toHaveAttribute("href", "/compliance");
    for (const group of COMPLIANCE_GROUPS) {
      const section = document.getElementById(group.id) as HTMLElement;
      expect(within(section).getByRole("heading", { level: 2, name: group.title })).toBeInTheDocument();
      // A group shows its own rows and no other group's.
      for (const item of group.items) expect(within(section).getByRole("heading", { level: 3, name: item.name })).toBeInTheDocument();
      const others = ITEMS.filter((i) => !group.items.includes(i));
      for (const item of others) expect(within(section).queryByRole("heading", { level: 3, name: item.name })).not.toBeInTheDocument();
    }
  });

  it("shows every row with its status, evidence, check date and open items", async () => {
    await renderServerPage(AdminCompliancePage, {});
    for (const item of ITEMS) {
      const card = document.getElementById(complianceItemId(item.name)) as HTMLElement;
      expect(card).not.toBeNull();
      expect(within(card).getByText(COMPLIANCE_STATUSES[item.status])).toBeInTheDocument();
      expect(within(card).getByText(containsText(item.detail))).toBeInTheDocument();
      for (const where of item.evidence) expect(within(card).getByText(where)).toBeInTheDocument();
      expect(within(card).getByText(item.checked)).toBeInTheDocument();
      for (const text of item.open) expect(within(card).getByText(containsText(text))).toBeInTheDocument();
    }
  });

  it("counts the open items and links each to its row", async () => {
    await renderServerPage(AdminCompliancePage, {});
    const total = ITEMS.reduce((n, i) => n + i.open.length, 0);
    expect(total).toBeGreaterThan(0);
    const box = screen.getByRole("heading", { level: 2, name: `Still open (${total})` }).closest("aside") as HTMLElement;
    const first = ITEMS.find((i) => i.open.length > 0)!;
    const entry = within(box).getByText(first.open[0], { exact: false }).closest("li") as HTMLElement;
    expect(within(entry).getByRole("link", { name: first.name })).toHaveAttribute("href", `#${complianceItemId(first.name)}`);
  });

  it("lists the services we rely on", async () => {
    await renderServerPage(AdminCompliancePage, {});
    const providers = within(document.getElementById("providers") as HTMLElement);
    // Two roles can be served by one provider today, so look up by role and check the name in the same row.
    for (const p of COMPLIANCE_PROVIDERS) {
      const row = providers.getByText(p.role).closest("tr") as HTMLElement;
      expect(within(row).getByText(p.name)).toBeInTheDocument();
    }
  });
});
