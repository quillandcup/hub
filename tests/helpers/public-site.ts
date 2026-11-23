import { vi } from "vitest";

/**
 * `@/lib/config` with the public-site switch (config/app.ts `publicSiteLive`) forced to one state, so a test file is about one state
 * whatever is committed. Every value that depends on the switch is what `publicSite(live)` computes (src/lib/config.ts), so the
 * test and the code cannot disagree about the derived addresses:
 *
 *   vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.liveConfigModule()));   // after the cutover
 *   vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.notLiveConfigModule())); // before it
 *
 * One file is one state: a test that needs both says so in two files, or calls `publicSite(false)` and `publicSite(true)` and
 * passes the result to the function under test.
 */
async function configModule(live: boolean) {
  const real = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
  const site = real.publicSite(live);
  return {
    ...real,
    PUBLIC_SITE_LIVE: live,
    PUBLIC_PAGES_URL: site.PUBLIC_PAGES_URL,
    SITE_URL: site.SITE_URL,
    KAJABI_SITE_URL: site.KAJABI_SITE_URL,
    KAJABI_LOGIN_URL: site.KAJABI_LOGIN_URL,
    JOIN_URL: site.JOIN_URL,
    ROOT_HOST: site.ROOT_HOST,
    SITE_ALIAS_HOSTS: site.SITE_ALIAS_HOSTS,
  };
}

export const liveConfigModule = () => configModule(true);
export const notLiveConfigModule = () => configModule(false);
