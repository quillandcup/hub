// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
const requirePermission = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requirePermission: () => requirePermission() }));

import AdminChangelogPage from "@/app/(admin)/admin/changelog/page";
import AdminChangelogEntryPage, { generateMetadata, generateStaticParams } from "@/app/(admin)/admin/changelog/[slug]/page";
import { CHANGELOG_ENTRIES } from "@/content/changelog";
import { listProductChangelog } from "@/lib/changelog";

const listProps = (searchParams: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
const entryProps = (slug: string) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
const links = () => screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "").filter((h) => /^\/admin\/changelog\/[^?]/.test(h));

beforeEach(() => {
  resetServerPageMocks();
  requirePermission.mockClear();
});

describe("admin changelog list", () => {
  it("is for admins only, and lists product and engineering entries with a link each", async () => {
    await renderServerPage(AdminChangelogPage, listProps());
    expect(requirePermission).toHaveBeenCalled();
    expect(links().sort()).toEqual(CHANGELOG_ENTRIES.map((e) => `/admin/changelog/${e.slug}`).sort());
  });

  it("groups by month, newest first", async () => {
    await renderServerPage(AdminChangelogPage, listProps());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).filter((h) => h !== "Held (not released yet)");
    expect(headings[0]).toMatch(/^[A-Z][a-z]+ 20\d\d$/);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it("shows a held entry first, in its own group, labelled Held and with no date", async () => {
    const held = CHANGELOG_ENTRIES.filter((e) => e.held);
    expect(held.length).toBeGreaterThan(0);
    await renderServerPage(AdminChangelogPage, listProps());
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("Held (not released yet)");
    const row = screen.getByRole("link", { name: new RegExp(held[0].title) });
    expect(row).toHaveTextContent("Held, not released");
    expect(row.querySelector("time")).toBeNull();
  });

  it("opens a held entry with the Held label", async () => {
    const held = CHANGELOG_ENTRIES.find((e) => e.held)!;
    await renderServerPage(AdminChangelogEntryPage, entryProps(held.slug));
    expect(screen.getByText("Held, not released")).toBeInTheDocument();
  });

  it("filters to engineering entries, marks the filter on, and keeps the search words in the links", async () => {
    await renderServerPage(AdminChangelogPage, listProps({ for: "engineering", q: "slack" }));
    const audience = screen.getByRole("navigation", { name: "For" });
    expect(within(audience).getByRole("link", { name: "Engineering" })).toHaveAttribute("aria-current", "true");
    expect(within(audience).getByRole("link", { name: "Product" })).toHaveAttribute("href", "/admin/changelog?q=slack&for=product");
    expect(screen.getByRole("searchbox", { name: "Search updates" })).toHaveValue("slack");
    const shown = new Set(links());
    const engineering = CHANGELOG_ENTRIES.filter((e) => e.audience === "engineering").map((e) => `/admin/changelog/${e.slug}`);
    for (const href of shown) expect(engineering).toContain(href);
    expect(shown.size).toBeGreaterThan(0);
  });

  it("filters to staff entries, which the admin Changelog shows beside the others", async () => {
    await renderServerPage(AdminChangelogPage, listProps({ for: "staff" }));
    const audience = screen.getByRole("navigation", { name: "For" });
    expect(within(audience).getByRole("link", { name: "Staff" })).toHaveAttribute("aria-current", "true");
    const staff = CHANGELOG_ENTRIES.filter((e) => e.audience === "staff").map((e) => `/admin/changelog/${e.slug}`);
    expect(staff.length).toBeGreaterThan(0);
    expect(links().sort()).toEqual(staff.sort());
  });

  it("says when nothing matches", async () => {
    await renderServerPage(AdminChangelogPage, listProps({ q: "zzzqqqxxx" }));
    expect(screen.getByText("Nothing matches that.")).toBeInTheDocument();
  });
});

describe("admin changelog entry", () => {
  it("shows an engineering entry, which has no member page, without a link to one", async () => {
    const eng = CHANGELOG_ENTRIES.find((e) => e.audience === "engineering")!;
    await renderServerPage(AdminChangelogEntryPage, entryProps(eng.slug));
    expect(requirePermission).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: eng.title, level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See it as members do" })).not.toBeInTheDocument();
  });

  it("shows a staff entry, which has no member page, without a link to one", async () => {
    const staff = CHANGELOG_ENTRIES.find((e) => e.audience === "staff" && e.category === "new")!;
    await renderServerPage(AdminChangelogEntryPage, entryProps(staff.slug));
    expect(screen.getByRole("heading", { name: staff.title, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Staff · New/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See it as members do" })).not.toBeInTheDocument();
  });

  it("links a product entry to the page members see", async () => {
    const product = listProductChangelog()[0];
    await renderServerPage(AdminChangelogEntryPage, entryProps(product.slug));
    expect(screen.getByRole("link", { name: "See it as members do" })).toHaveAttribute("href", `/changelog/${product.slug}`);
  });

  it("404s on an unknown slug, prerenders every entry and titles each page", async () => {
    await expect(AdminChangelogEntryPage(entryProps("nope"))).rejects.toThrow("404");
    expect(generateStaticParams()).toHaveLength(CHANGELOG_ENTRIES.length);
    const e = CHANGELOG_ENTRIES[0];
    expect(await generateMetadata(entryProps(e.slug))).toEqual({ title: `${e.title} · Changelog` });
    expect(await generateMetadata(entryProps("nope"))).toEqual({ title: "Changelog" });
  });
});
