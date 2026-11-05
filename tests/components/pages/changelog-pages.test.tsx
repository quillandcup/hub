// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/components/changelog/ChangelogEntryViewed", () => ({ default: () => null }));

import ChangelogPage from "@/app/(member)/changelog/page";
import ChangelogEntryPage, { generateMetadata, generateStaticParams } from "@/app/(member)/changelog/[slug]/page";
import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";
import { listProductChangelog } from "@/lib/changelog";

const USER = { id: "user-1", email: "member1@example.com" };

describe("changelog pages", () => {
  beforeEach(() => {
    resetServerPageMocks();
  });

  it("sends a signed-out visitor to login", async () => {
    signInAs(null, null);
    await expectRedirect(ChangelogPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) }, "/login");
  });

  it("lists every entry with a link to its page", async () => {
    signInAs(USER, null);
    await renderServerPage(ChangelogPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) });
    // A link per product entry (by its address, since titles can repeat words); engineering entries have no page, so no link.
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const e of CHANGELOG_ENTRIES) {
      expect(hrefs.includes(`/changelog/${e.slug}`), e.slug).toBe(e.audience === "product");
    }
  });

  const entryLinks = () => screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith("/changelog/") && !h.includes("?"));

  it("filters by New, Improved or Fixed with links you can share, and marks the one that is on", async () => {
    signInAs(USER, null);
    await renderServerPage(ChangelogPage, { params: Promise.resolve({}), searchParams: Promise.resolve({ show: "fixed" }) });
    const nav = screen.getByRole("navigation", { name: "Show" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["All", "/changelog"],
      ["New", "/changelog?show=new"],
      ["Improved", "/changelog?show=improved"],
      ["Fixed", "/changelog?show=fixed"],
    ]);
    expect(within(nav).getByRole("link", { name: "Fixed" })).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
    const fixed = listProductChangelog().filter((e) => e.category === "fixed").map((e) => `/changelog/${e.slug}`);
    expect(entryLinks().sort()).toEqual(fixed.sort());
  });

  it("shows everything for no filter or one that is not a category", async () => {
    signInAs(USER, null);
    await renderServerPage(ChangelogPage, { params: Promise.resolve({}), searchParams: Promise.resolve({ show: "everything" }) });
    expect(entryLinks()).toHaveLength(listProductChangelog().length);
    expect(within(screen.getByRole("navigation", { name: "Show" })).getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
  });

  it("shows one entry", async () => {
    signInAs(USER, null);
    const e = listProductChangelog()[0];
    await renderServerPage(ChangelogEntryPage, { params: Promise.resolve({ slug: e.slug }), searchParams: Promise.resolve({}) });
    expect(screen.getByRole("heading", { name: e.title })).toBeInTheDocument();
  });

  it("gives an engineering entry no page", async () => {
    signInAs(USER, null);
    const eng = CHANGELOG_ENTRIES.find((e) => e.audience === "engineering");
    if (!eng) return; // none committed yet
    await expect(ChangelogEntryPage({ params: Promise.resolve({ slug: eng.slug }), searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  });

  it("404s on an unknown slug", async () => {
    signInAs(USER, null);
    await expect(ChangelogEntryPage({ params: Promise.resolve({ slug: "nope" }), searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  });

  it("prerenders one page per entry and titles it", async () => {
    expect(generateStaticParams()).toEqual(listProductChangelog().map((e) => ({ slug: e.slug })));
    const e = listProductChangelog()[0];
    expect(await generateMetadata({ params: Promise.resolve({ slug: e.slug }), searchParams: Promise.resolve({}) })).toEqual({ title: `${e.title} · What's new` });
    expect(await generateMetadata({ params: Promise.resolve({ slug: "nope" }), searchParams: Promise.resolve({}) })).toEqual({ title: "What's new" });
  });
});
