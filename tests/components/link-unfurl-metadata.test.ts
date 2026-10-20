/**
 * Link unfurls (Slack, Facebook, LinkedIn) need an absolute og:image and a twitter card. Next builds
 * the image tags from app/opengraph-image.png and app/twitter-image.png, sized per platform.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import appConfig from "@/app.config";
import { APP_URL } from "@/lib/config";

// Imported only so the layout module loads in a node test; none of it runs here.
vi.mock("next/font/google", () => ({ Playfair_Display: () => ({ variable: "", className: "" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("./providers/ThemeProvider", () => ({ ThemeProvider: () => null }));
vi.mock("@/app/providers/ThemeProvider", () => ({ ThemeProvider: () => null }));
vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));
vi.mock("@next/third-parties/google", () => ({ GoogleAnalytics: () => null }));
vi.mock("@/components/EnvironmentIndicator", () => ({ EnvironmentIndicator: () => null }));
vi.mock("@/components/ConsentBanner", () => ({ ConsentBanner: () => null }));
vi.mock("@/components/AnalyticsIdentity", () => ({ AnalyticsIdentity: () => null }));
vi.mock("@/components/AnalyticsEvents", () => ({ AnalyticsEvents: () => null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => null }));

function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(path.join(process.cwd(), "app", file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("link unfurl metadata", () => {
  it("resolves image URLs against the app URL and asks for a square summary card", async () => {
    const { metadata } = await import("@/app/layout");
    expect(String(metadata.metadataBase)).toBe(`${APP_URL}/`);
    expect(metadata.openGraph).toMatchObject({ siteName: appConfig.appName, type: "website" });
    expect(metadata.twitter).toMatchObject({ card: "summary" });
  });

  it("has a 1.91:1 og:image for Facebook and LinkedIn", () => {
    expect(pngSize("opengraph-image.png")).toEqual({ width: 1200, height: 630 });
  });

  it("has a square twitter:image for Slack's thumbnail", () => {
    expect(pngSize("twitter-image.png")).toEqual({ width: 1200, height: 1200 });
  });
});
