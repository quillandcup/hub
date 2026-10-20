/**
 * Link unfurls (Slack, Facebook, LinkedIn) need an absolute og:image and a twitter card. Next builds
 * the image tags from app/opengraph-image.jpg, 1200x630.
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

// Reads the size from the JPEG's start-of-frame marker.
function jpegSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(path.join(process.cwd(), "app", file));
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`no frame header in ${file}`);
}

// Slack's unfurl fetcher drops large images, so keep the photos small.
const MAX_BYTES = 500 * 1024;
function bytes(file: string): number {
  return fs.statSync(path.join(process.cwd(), "app", file)).size;
}

describe("link unfurl metadata", () => {
  it("resolves image URLs against the app URL and asks for a summary twitter card", async () => {
    const { metadata } = await import("@/app/layout");
    expect(String(metadata.metadataBase)).toBe(`${APP_URL}/`);
    expect(metadata.openGraph).toMatchObject({ siteName: appConfig.appName, type: "website" });
    expect(metadata.twitter).toMatchObject({ card: "summary" });
  });

  it("has one 1.91:1 og:image; Slack crops its central square, so the content is centered", () => {
    expect(jpegSize("opengraph-image.jpg")).toEqual({ width: 1200, height: 630 });
  });

  it("keeps the image small enough for Slack to fetch", () => {
    expect(bytes("opengraph-image.jpg")).toBeLessThan(MAX_BYTES);
  });
});
