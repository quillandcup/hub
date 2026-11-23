/**
 * The cutover switch (config/app.ts `publicSiteLive`): what it changes in each state, as pure values and decisions. The files that
 * force a whole state are the ones with `liveConfigModule` / `notLiveConfigModule` (tests/helpers/public-site.ts): root-routing.test.ts,
 * proxy-root-host.test.ts, root-homepage.test.tsx, LoginForm.test.tsx and root-redirect-check.test.ts are "live";
 * proxy-public-site-not-live.test.ts and LoginForm-not-live.test.tsx are "not live". Files about the public pages (canonical
 * addresses, sitemaps, robots) are named in the "Where the switch is read" list below.
 *
 * WHERE THE SWITCH IS READ (every place; this list is the audit):
 *   config/app.ts          `publicSiteLive`, `publicSiteConfig(live)`: the Kajabi site and the public site's addresses
 *   src/lib/config.ts      `PUBLIC_SITE_LIVE`, `PUBLIC_PAGES_URL`, `publicSite(live)`: everything derived (ROOT_HOST, KAJABI_*, JOIN_URL)
 *   src/lib/root-routing.ts  `RoutingConfig.live`: decideRoute is "pass, app host" for everything and isRootHost is false while off
 *   src/proxy.ts           the trailing-slash 308 (only live; off, Next's own redirect stays on)
 *   next.config.ts         `skipTrailingSlashRedirect` (only live)
 *   src/app/login/LoginForm.tsx   the "Still on Kajabi?" note (only live)
 *   src/app/p/[slug]/page.tsx     the canonical of `home` (`/`, only live)
 *   src/app/p/[slug]/page.tsx     the canonical of `home` (`/`, only live) and every landing page's origin (PUBLIC_PAGES_URL)
 *   src/app/robots.ts      the writers' sitemaps on any host until live, only on the root host after; the landing sitemap only live
 *   src/app/sitemap.ts     (through isRootHost) empty until live
 *   src/lib/landing/address.ts   `/p/<slug>` on the Hub host until live, the bare `/<slug>` on the root host after (PagesTable copy link,
 *                          the editor and new-page form labels, canonical and Open Graph, the landing sitemap)
 *   and, through PUBLIC_PAGES_URL: writer profile and sitemap addresses, the layout's metadataBase, the Settings address and the
 *   admin copy link. The "not live" tests: public-pages-not-live.test.ts, landing-address-not-live.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { publicSiteConfig, publicSiteLive } from "@/config/app";
import { APP_URL, publicSite } from "@/lib/config";
import { DEFAULT_ROUTING, decideRoute, isRootHost, type RoutingConfig } from "@/lib/root-routing";

const NOT_LIVE = publicSite(false);
const LIVE = publicSite(true);

describe("the addresses the switch changes", () => {
  it("keeps the public site and the Kajabi site at one address, today's, until the cutover", () => {
    expect(NOT_LIVE.SITE_URL).toBe(NOT_LIVE.KAJABI_SITE_URL);
    expect(NOT_LIVE.KAJABI_LOGIN_URL).toBe(`${NOT_LIVE.KAJABI_SITE_URL}/login`);
    expect(NOT_LIVE.FEATURED_COURSE_OFFER_URL).toBe(`${NOT_LIVE.KAJABI_SITE_URL}/waitlist`);
    expect(NOT_LIVE.JOIN_URL).toBe(`${NOT_LIVE.SITE_URL}/free-trial`);
  });

  it("moves Kajabi to its own host and the public site to the root domain after it", () => {
    expect(LIVE.SITE_URL).not.toBe(LIVE.KAJABI_SITE_URL);
    expect(new URL(LIVE.KAJABI_SITE_URL).host.endsWith(`.${LIVE.ROOT_HOST}`)).toBe(true);
    expect(LIVE.KAJABI_LOGIN_URL).toBe(`${LIVE.KAJABI_SITE_URL}/login`);
    expect(LIVE.FEATURED_COURSE_OFFER_URL).toBe(`${LIVE.KAJABI_SITE_URL}/waitlist`);
    expect(LIVE.JOIN_URL).toBe(`${LIVE.SITE_URL}/free-trial`);
  });

  it("puts the public pages on the Hub host until the cutover and on the root host after it", () => {
    expect(NOT_LIVE.PUBLIC_PAGES_URL).toBe(APP_URL);
    expect(LIVE.PUBLIC_PAGES_URL).toBe(LIVE.SITE_URL);
  });

  it("takes every value in the committed config from the same function", () => {
    const committed = publicSiteConfig(publicSiteLive);
    expect(publicSite(publicSiteLive).KAJABI_SITE_URL).toBe(committed.kajabiSiteUrl);
  });
});

describe("the routing while the switch is off", () => {
  const off: RoutingConfig = { ...DEFAULT_ROUTING, live: false, rootHost: LIVE.ROOT_HOST, siteUrl: LIVE.SITE_URL, kajabiUrl: LIVE.KAJABI_SITE_URL, aliasHosts: LIVE.SITE_ALIAS_HOSTS };
  const on: RoutingConfig = { ...off, live: true };
  const request = (host: string, pathname: string) => ({ host, method: "GET", pathname, search: "?a=1" });

  it("treats every host and path as the app's: nothing is redirected, whatever the host", () => {
    for (const host of [LIVE.ROOT_HOST, ...LIVE.SITE_ALIAS_HOSTS, new URL(APP_URL).host, "localhost:3000"]) {
      for (const pathname of ["/", "/dashboard", "/products/example", "/library", "/p/spring", "/w/ada-example", "/login"]) {
        expect(decideRoute(request(host, pathname), off), `${host}${pathname}`).toEqual({ action: "pass", host: "app" });
      }
    }
  });

  it("does not know a root host while off, and does once on", () => {
    expect(isRootHost(LIVE.ROOT_HOST, off)).toBe(false);
    expect(isRootHost(LIVE.ROOT_HOST, on)).toBe(true);
  });

  it("is the live behavior with the switch on (the root host sends an old address to Kajabi)", () => {
    const d = decideRoute(request(LIVE.ROOT_HOST, "/products/example"), on);
    expect(d).toEqual({ action: "redirect", location: `${LIVE.KAJABI_SITE_URL}/products/example?a=1`, status: 307 });
  });
});
