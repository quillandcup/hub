// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, within } from "@testing-library/react";
import { MEMBER_IDENTITY, MEMBER_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { PRIVACY_GROUPS } from "@/lib/privacy-promises";
import { PRIVACY_SECTIONS, PRIVACY_SUMMARY, privacyText, privacyUnits } from "@/lib/privacy";
import { plainText } from "@/lib/trust-text";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/analytics/opt-out", () => ({ isAnalyticsOptedOut: () => Promise.resolve(false) }));
vi.mock("@/app/privacy/actions", () => ({ setAnalyticsOptOut: vi.fn() }));
const requireAdminPage = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

import PrivacyPage from "@/app/privacy/page";
import AdminPrivacyPage from "@/app/(admin)/admin/privacy/page";

/** Whitespace as a reader sees it. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const ROWS = PRIVACY_GROUPS.flatMap((g) => g.rows);

describe("the Privacy page and its staff view read one list", () => {
  beforeEach(() => {
    resetServerPageMocks();
    requireAdminPage.mockResolvedValue({ id: "admin" });
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
  });

  it("shows on the staff page, as Members read, the words the member page shows for the same promise", async () => {
    await renderServerPage(PrivacyPage, {});
    const page = flat(document.body.textContent ?? "");
    const units = new Map(privacyUnits().map((u) => [u.id, u]));
    // Every sentence or row a promise reads is on the member page, word for word.
    for (const row of ROWS) {
      for (const id of row.reads) {
        const unit = units.get(id)!;
        expect(unit, `${row.id} reads "${id}", which is not in lib/privacy.ts`).toBeDefined();
        for (const shown of unit.shown) expect(page, `"${shown.slice(0, 50)}..." (${id}) is not on /privacy`).toContain(flat(shown));
      }
    }
    cleanup();

    await renderServerPage(AdminPrivacyPage, {});
    for (const row of ROWS) {
      const card = document.getElementById(row.id) as HTMLElement;
      const read = within(card).getByText(/^Members read:/).closest("p")!;
      expect(flat(read.textContent ?? "")).toBe(flat(`Members read: ${privacyText(row.reads)}`));
      expect(row.member).toBe(privacyText(row.reads));
    }
  });

  it("holds no member-facing sentence twice: a promise's text is its items' text, with nothing of its own", () => {
    for (const row of ROWS) {
      expect(row.reads.length).toBeGreaterThan(0);
      expect(row.member).toBe(row.reads.map((id) => privacyText([id])).join(" "));
    }
  });

  it("gives every item a unique id, and fails loudly on an unknown one", () => {
    const ids = privacyUnits().map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => privacyText(["no-such-item"])).toThrow(/no item with id "no-such-item"/);
  });

  it("describes a table row by its first cell and its labelled columns", () => {
    expect(privacyText(["chat-restricted"])).toBe("Restricted private channels (Activity: Yes; Content: No, except break-glass access (below))");
  });

  it("keeps the unfinished parts worded as unfinished", () => {
    const planned = privacyText(["chat-planned"]);
    expect(planned).toContain("Not yet. Planned: yes");
    expect(planned).toContain("Not yet. Planned: restricted, so break-glass access only");
    expect(privacyText(["chat-break-glass"])).toContain("we will record who looked, why and when");
  });

  it("renders every section and summary line from the list", async () => {
    await renderServerPage(PrivacyPage, {});
    for (const section of PRIVACY_SECTIONS) {
      expect(within(document.getElementById(section.id) as HTMLElement).getByRole("heading", { level: 2, name: section.title })).toBeInTheDocument();
    }
    const summary = flat(document.querySelector("aside")?.textContent ?? "");
    for (const item of PRIVACY_SUMMARY) expect(summary).toContain(flat(plainText(item.text)));
  });
});
