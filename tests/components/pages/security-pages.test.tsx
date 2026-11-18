// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { MEMBER_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { SUPPORT_EMAIL } from "@/lib/config";
import { COMPLIANCE_STATUSES } from "@/lib/compliance";
import { SECURITY_EFFECTIVE, SECURITY_ITEMS } from "@/lib/security";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));

const requireAdminPage = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

import SecurityPage from "@/app/security/page";
import AdminSecurityPage from "@/app/(admin)/admin/security/page";
import { containsText } from "@/tests/helpers/contains-text";

describe("/security (members)", () => {
  beforeEach(() => {
    resetServerPageMocks();
  });

  it("is public: a signed-out visitor reads it, with a sign-in link", async () => {
    signInAs(null);
    await renderServerPage(SecurityPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to the Hub" })).toHaveAttribute("href", "/login");
    expect(screen.getByText(SECURITY_EFFECTIVE)).toBeInTheDocument();
  });

  it("gives a signed-in member a way back to the Hub", async () => {
    signInAs(MEMBER_USER);
    await renderServerPage(SecurityPage, {});
    expect(screen.getByRole("link", { name: "Back to the Hub" })).toHaveAttribute("href", "/dashboard");
  });

  it("lists every row with its status as words and the member text, and none of the staff detail", async () => {
    signInAs(null);
    await renderServerPage(SecurityPage, {});
    for (const item of SECURITY_ITEMS) {
      const card = screen.getByRole("heading", { level: 3, name: item.title }).closest("li") as HTMLElement;
      expect(within(card).getByText(COMPLIANCE_STATUSES[item.status])).toBeInTheDocument();
      expect(within(card).getByText(containsText(item.member))).toBeInTheDocument();
      expect(screen.queryByText(item.staff.how)).not.toBeInTheDocument();
      for (const text of item.staff.open) expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it("links to the privacy and compliance pages and tells people how to report a problem", async () => {
    signInAs(null);
    await renderServerPage(SecurityPage, {});
    expect(screen.getByRole("link", { name: "Privacy page" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Compliance page" })).toHaveAttribute("href", "/compliance");
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
  });
});

describe("/admin/security (staff)", () => {
  beforeEach(() => {
    requireAdminPage.mockReset();
    requireAdminPage.mockResolvedValue({ id: "admin" });
  });

  it("checks for an admin first and shows nothing when the check redirects", async () => {
    requireAdminPage.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(AdminSecurityPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(requireAdminPage).toHaveBeenCalledTimes(1);
  });

  it("shows every row with the member text, how it works, where it is enforced and when it was checked", async () => {
    await renderServerPage(AdminSecurityPage, {});
    expect(screen.getByRole("link", { name: "Security page" })).toHaveAttribute("href", "/security");
    for (const item of SECURITY_ITEMS) {
      const card = screen.getByRole("heading", { level: 3, name: item.title }).closest("li") as HTMLElement;
      expect(card).toHaveAttribute("id", item.id);
      expect(within(card).getByText(containsText(item.member))).toBeInTheDocument();
      expect(within(card).getByText(containsText(item.staff.how))).toBeInTheDocument();
      for (const where of item.staff.evidence) expect(within(card).getByText(where)).toBeInTheDocument();
      expect(within(card).getByText(item.staff.checked)).toBeInTheDocument();
    }
  });

  it("counts what is still open and links each to its row", async () => {
    await renderServerPage(AdminSecurityPage, {});
    const openCount = SECURITY_ITEMS.reduce((n, item) => n + item.staff.open.length, 0);
    expect(openCount).toBeGreaterThan(0);
    const box = screen.getByRole("heading", { level: 2, name: `Still open (${openCount})` }).closest("aside") as HTMLElement;
    for (const item of SECURITY_ITEMS.filter((i) => i.staff.open.length > 0)) {
      for (const text of item.staff.open) {
        const li = within(box).getByText(containsText(text)).closest("li") as HTMLElement;
        expect(within(li).getAllByRole("link", { name: item.title })[0]).toHaveAttribute("href", `#${item.id}`);
      }
    }
  });
});

describe("security list: encryption", () => {
  const ids = SECURITY_ITEMS.map((i) => i.id);

  it("keeps the three encryption rows together, in transit before at rest, with parallel titles", () => {
    const at = (id: string) => ids.indexOf(id);
    expect([at("database-in-transit") - at("in-transit"), at("at-rest") - at("database-in-transit")]).toEqual([1, 1]);
    const titles = ["in-transit", "database-in-transit", "at-rest"].map((id) => SECURITY_ITEMS.find((i) => i.id === id)!.title);
    expect(titles.every((t) => t.startsWith("Encrypted "))).toBe(true);
  });

  it("says uploaded files are covered as a reading of the provider's general statement, and has no open item left for storage or the hosting settings", () => {
    const rest = SECURITY_ITEMS.find((i) => i.id === "at-rest")!;
    expect(rest.title).toMatch(/uploaded files/);
    expect(rest.member).toMatch(/including the files you upload/);
    expect(rest.member).not.toMatch(/we read|we understand|probably|should/i);
    expect(rest.staff.how).toMatch(/we read the general statement as covering uploaded files/);
    expect(rest.staff.how).toMatch(/write-only after saving/);
    expect(rest.staff.open.join(" ")).not.toMatch(/storage buckets|write-only|sensitive/i);
  });

  it("says TLS, not HTTPS, to members about the database connection", () => {
    const db = SECURITY_ITEMS.find((i) => i.id === "database-in-transit")!;
    expect(db.member).toContain("TLS");
    expect(db.member).not.toMatch(/HTTP/);
  });

  it("no longer lists GitHub secret scanning as unchecked, and records the check", () => {
    const keys = SECURITY_ITEMS.find((i) => i.id === "service-keys")!;
    expect(keys.staff.open.join(" ")).not.toMatch(/secret scanning/i);
    expect(keys.staff.how).toMatch(/secret scanning and push protection are both on/);
  });
});

describe("security list", () => {
  it("has unique ids, dated checks and evidence for every row", () => {
    const ids = SECURITY_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SECURITY_ITEMS) {
      expect(item.staff.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.staff.evidence.length).toBeGreaterThan(0);
      // The member text is plain: no file paths or code.
      expect(item.member).not.toMatch(/[`/]|\.tsx?\b/);
    }
  });

  it("keeps the public-repo rule: no emails, keys or hosts in the list", () => {
    const text = JSON.stringify(SECURITY_ITEMS);
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\b(sk|pk|xox[bp])[-_][A-Za-z0-9]{8,}/);
  });
});
