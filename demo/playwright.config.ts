import { defineConfig, devices } from "playwright/test";
import { appConfig } from "../app.config";

/**
 * Every scene runs in each size and colour scheme. The sizes include widths either side of the app's sidebar
 * breakpoint (lg, 1024px): tablet portrait is below it, tablet landscape and desktop above. For captures only
 * (screenshots for an article), run one project: `pnpm demo:capture --project=desktop-light`.
 */
const SIZES = {
  // Chromium at the iPhone's size, touch and user agent: the profile's own WebKit isn't installed (add it for Safari-accurate checks).
  phone: { ...devices["iPhone 14"], defaultBrowserType: "chromium" as const },
  "tablet-portrait": { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  "tablet-landscape": { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 } },
} as const;

const SCHEMES = ["light", "dark"] as const;

export default defineConfig({
  testDir: ".",
  testMatch: ["scenes/**/*.spec.ts", "selftest/**/*.spec.ts"],
  outputDir: "out/.playwright",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DEMO_APP_URL ?? "http://localhost:3100",
    video: process.env.DEMO_VIDEO ? "on" : "off",
    trace: "off",
    // The org's zone and a fixed locale, so times on screen don't depend on the machine running the scene.
    timezoneId: appConfig.orgTimezone,
    locale: "en-US",
  },
  projects: Object.entries(SIZES).flatMap(([size, device]) =>
    SCHEMES.map((scheme) => ({
      name: `${size}-${scheme}`,
      use: { ...device, colorScheme: scheme },
    })),
  ),
});
