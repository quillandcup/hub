// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  notFound,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";
import { SUPPORT_EMAIL } from "@/lib/config";
import HelpPage from "@/app/(member)/help/page";
import HelpArticlePage, { generateMetadata, generateStaticParams } from "@/app/(member)/help/[slug]/page";
import { track } from "@/lib/analytics/client";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

const articleProps = (slug: string) => ({ params: Promise.resolve({ slug }) }) as Parameters<typeof HelpArticlePage>[0];

describe("/help", () => {
  beforeEach(() => {
    resetServerPageMocks();
    vi.mocked(track).mockClear();
  });

  it("sends a signed-out visitor to sign in", async () => {
    signInAs(null);
    await expectRedirect(HelpPage, undefined, "/login");
  });

  it("lists the articles with their summaries and the support address", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    await renderServerPage(HelpPage, undefined);
    expect(screen.getByRole("heading", { level: 1, name: "Hedgie Help" })).toBeInTheDocument();
    expect(screen.getByText("How things work in the Hedgie House.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /How to join a prickle/ })).toHaveAttribute("href", "/help/join-a-prickle");
    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
  });
});

describe("/help/[slug]", () => {
  beforeEach(() => {
    resetServerPageMocks();
    vi.mocked(track).mockClear();
  });

  it("builds a page for every article ahead of time", () => {
    expect(generateStaticParams()).toContainEqual({ slug: "join-a-prickle" });
  });

  it("sends a signed-out visitor to sign in", async () => {
    signInAs(null);
    await expectRedirect(HelpArticlePage, articleProps("join-a-prickle"), "/login");
  });

  it("renders the article, its screenshots through the signed-in image route, and records the view", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    const { container } = await renderServerPage(HelpArticlePage, articleProps("join-a-prickle"));
    expect(screen.getByRole("heading", { level: 1, name: "How to join a prickle" })).toBeInTheDocument();
    const images = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(images).toContain("/help/images/join-a-prickle/02-on-air-popover.png");
    expect(images.every((src) => src?.startsWith("/help/images/"))).toBe(true);
    expect(screen.getByRole("link", { name: "← Hedgie Help" })).toHaveAttribute("href", "/help");
    expect(track).toHaveBeenCalledWith("help_article_viewed", { slug: "join-a-prickle" });
  });

  it("answers an unknown or unsafe slug with not found", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    await expect(renderServerPage(HelpArticlePage, articleProps("missing"))).rejects.toThrow();
    await expect(renderServerPage(HelpArticlePage, articleProps("../package"))).rejects.toThrow();
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it("titles the tab with the article first, then the section", async () => {
    expect(await generateMetadata(articleProps("join-a-prickle"))).toEqual({ title: "How to join a prickle · Hedgie Help" });
    expect(await generateMetadata(articleProps("missing"))).toEqual({ title: "Hedgie Help" });
  });
});
