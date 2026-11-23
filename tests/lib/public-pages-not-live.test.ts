/**
 * The public pages while the public site is NOT live (config/app.ts `publicSiteLive` false, the state until the cutover): their
 * addresses, sitemaps and robots.txt name the Hub host, and the Hub host's `/`, `/p/<slug>` and `/w/<handle>` answer as they did
 * before the root-host work. The same functions with the switch on are tested in writer-profiles.test.tsx, landing-pages.test.tsx
 * and link-unfurl-metadata.test.ts (the "live" files, which mock `liveConfigModule`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { APP_URL, PUBLIC_PAGES_URL, publicSite } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.notLiveConfigModule()));

const state = vi.hoisted(() => ({ host: "", user: null as null | { id: string }, repos: undefined as unknown as import("@/lib/data/repos").Repos }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: state.host }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
// The layout module only has to load in a node test.
vi.mock("next/font/google", () => ({ Playfair_Display: () => ({ variable: "", className: "" }) }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/app/providers/ThemeProvider", () => ({ ThemeProvider: () => null }));
vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));
vi.mock("@next/third-parties/google", () => ({ GoogleAnalytics: () => null }));
vi.mock("@/components/EnvironmentIndicator", () => ({ EnvironmentIndicator: () => null }));
vi.mock("@/components/ConsentBanner", () => ({ ConsentBanner: () => null }));
vi.mock("@/components/AnalyticsIdentity", () => ({ AnalyticsIdentity: () => null }));
vi.mock("@/components/AnalyticsEvents", () => ({ AnalyticsEvents: () => null }));

const APP_HOST = new URL(APP_URL).host;
const ROOT_HOST = publicSite(true).ROOT_HOST;

beforeEach(() => {
  state.host = APP_HOST;
  state.user = null;
  state.repos = createInMemoryRepos(new InMemoryDataset());
});

describe("addresses while not live", () => {
  it("are the Hub host's: the public pages' origin is the app's", () => {
    expect(PUBLIC_PAGES_URL).toBe(APP_URL);
  });

  it("builds a writer's page address and the sitemap files' addresses on the Hub host", async () => {
    const { writerProfileUrl } = await import("@/lib/writer-profile");
    const { sitemapUrl } = await import("@/lib/writer-sitemap");
    expect(writerProfileUrl("ada-example")).toBe(`${APP_URL}/w/ada-example`);
    expect(sitemapUrl(3)).toBe(`${APP_URL}/w/sitemap/3.xml`);
  });

  it("shows a writer the Hub host's address in Settings terms: the prefix is the app host", async () => {
    expect(new URL(PUBLIC_PAGES_URL).host).toBe(APP_HOST);
  });
});

describe("a landing page's head while not live", () => {
  async function publish(slug: string) {
    const page = await state.repos.landingPages.create({ title: slug, slug, createdBy: null });
    await state.repos.landingPages.updateDetails(page.id, { title: slug, slug, seoTitle: "Search title", seoDescription: "About", socialImageAssetId: "mda_SOCIAL" }, null);
    await state.repos.landingPages.publish(page.id);
  }

  it("names /p/<slug> on the Hub host as canonical and Open Graph address, and the Hub host for the social image", async () => {
    await publish("spring");
    const { generateMetadata } = await import("@/app/p/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "spring" }) });
    expect(metadata.alternates?.canonical).toBe(`${APP_URL}/p/spring`);
    expect(metadata.openGraph).toMatchObject({ url: `${APP_URL}/p/spring`, images: [{ url: expect.stringContaining(`${APP_URL}/`) }] });
    expect(JSON.stringify(metadata)).not.toContain(publicSite(true).SITE_URL);
  });

  it("keeps /p/home as the page `home`'s own address on the Hub host (no `/` canonical, no redirect)", async () => {
    await publish("home");
    const { generateMetadata, default: Page } = await import("@/app/p/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "home" }) });
    expect(metadata.alternates?.canonical).toBe(`${APP_URL}/p/home`);
    await expect(Page({ params: Promise.resolve({ slug: "home" }) })).resolves.toBeTruthy();
    state.host = ROOT_HOST;
    await expect(Page({ params: Promise.resolve({ slug: "home" }) })).resolves.toBeTruthy();
  });

  it("still 404s a draft and an unknown address", async () => {
    const { default: Page } = await import("@/app/p/[slug]/page");
    await expect(Page({ params: Promise.resolve({ slug: "never-made" }) })).rejects.toThrow("NOT_FOUND");
  });
});

describe("robots.txt and the layout while not live", () => {
  it("lists the writers' sitemaps on the Hub host, as before", async () => {
    const { default: robots } = await import("@/app/robots");
    expect(await robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/"] },
      sitemap: [`${APP_URL}/w/sitemap/0.xml`],
    });
  });

  it("lists the same on any other host asked, since there is no root host yet", async () => {
    state.host = ROOT_HOST;
    const { default: robots } = await import("@/app/robots");
    expect((await robots()).sitemap).toEqual([`${APP_URL}/w/sitemap/0.xml`]);
  });

  it("resolves metadata against the Hub host, even for a request with the root host's name", async () => {
    const { generateMetadata } = await import("@/app/layout");
    for (const host of [APP_HOST, ROOT_HOST]) {
      state.host = host;
      expect(String((await generateMetadata()).metadataBase)).toBe(`${APP_URL}/`);
    }
  });
});

describe("the front page while not live", () => {
  it("sends a signed-out visitor to /login and a signed-in one to the dashboard, on the Hub host and on the root host's name", async () => {
    const { default: Home } = await import("@/app/page");
    for (const host of [APP_HOST, ROOT_HOST]) {
      state.host = host;
      state.user = null;
      await expect(Home()).rejects.toThrow("REDIRECT:/login");
      state.user = { id: "user-1" };
      await expect(Home()).rejects.toThrow("REDIRECT:/dashboard");
    }
  });
});
