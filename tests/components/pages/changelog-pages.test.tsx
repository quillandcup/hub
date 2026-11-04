// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/components/changelog/ChangelogEntryViewed", () => ({ default: () => null }));

import ChangelogPage from "@/app/(member)/changelog/page";
import ChangelogEntryPage, { generateMetadata, generateStaticParams } from "@/app/(member)/changelog/[slug]/page";
import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";

const USER = { id: "user-1", email: "member1@example.com" };

describe("changelog pages", () => {
  beforeEach(() => {
    resetServerPageMocks();
  });

  it("sends a signed-out visitor to login", async () => {
    signInAs(null, null);
    await expectRedirect(ChangelogPage, {}, "/login");
  });

  it("lists every entry with a link to its page", async () => {
    signInAs(USER, null);
    await renderServerPage(ChangelogPage, {});
    for (const e of CHANGELOG_ENTRIES) {
      expect(screen.getByRole("link", { name: new RegExp(e.title) })).toHaveAttribute("href", `/changelog/${e.slug}`);
    }
  });

  it("shows one entry", async () => {
    signInAs(USER, null);
    const e = CHANGELOG_ENTRIES[0];
    await renderServerPage(ChangelogEntryPage, { params: Promise.resolve({ slug: e.slug }), searchParams: Promise.resolve({}) });
    expect(screen.getByRole("heading", { name: e.title })).toBeInTheDocument();
  });

  it("404s on an unknown slug", async () => {
    signInAs(USER, null);
    await expect(ChangelogEntryPage({ params: Promise.resolve({ slug: "nope" }), searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  });

  it("prerenders one page per entry and titles it", async () => {
    expect(generateStaticParams()).toEqual(CHANGELOG_ENTRIES.map((e) => ({ slug: e.slug })));
    const e = CHANGELOG_ENTRIES[0];
    expect(await generateMetadata({ params: Promise.resolve({ slug: e.slug }), searchParams: Promise.resolve({}) })).toEqual({ title: `${e.title} · What's new` });
    expect(await generateMetadata({ params: Promise.resolve({ slug: "nope" }), searchParams: Promise.resolve({}) })).toEqual({ title: "What's new" });
  });
});
