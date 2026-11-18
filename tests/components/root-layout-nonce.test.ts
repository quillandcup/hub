/**
 * The proxy makes a script nonce per request (lib/csp.ts, proxy.ts). The root layout passes it to the pieces that write inline
 * scripts and styles: the theme provider, the consent default script and the Google Analytics tag. Without it the browser
 * reports each of them as a violation (production reports, 2026-11-18).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { NONCE_HEADER } from "@/lib/csp";

const state: { headers: Headers } = { headers: new Headers() };

vi.mock("next/font/google", () => ({ Playfair_Display: () => ({ variable: "", className: "" }) }));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/script", () => ({ default: function Script() { return null; } }));
vi.mock("@/app/providers/ThemeProvider", () => ({ ThemeProvider: function ThemeProvider() { return null; } }));
vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));
vi.mock("@next/third-parties/google", () => ({ GoogleAnalytics: function GoogleAnalytics() { return null; } }));
vi.mock("@/components/EnvironmentIndicator", () => ({ EnvironmentIndicator: () => null }));
vi.mock("@/components/ConsentBanner", () => ({ ConsentBanner: () => null }));
vi.mock("@/components/AnalyticsIdentity", () => ({ AnalyticsIdentity: () => null }));
vi.mock("@/components/AnalyticsEvents", () => ({ AnalyticsEvents: () => null }));
vi.mock("@/components/SessionReplay", () => ({ SessionReplay: () => null }));
vi.mock("@/components/AnimationsController", () => ({ AnimationsController: () => null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => null }));

import RootLayout from "@/app/layout";

/** Every element in the tree whose component (or tag) has this name. */
function find(node: ReactNode, name: string, found: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => find(n, name, found));
  } else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<Record<string, unknown>>;
    const type = el.type as { name?: string } | string;
    if ((typeof type === "string" ? type : type.name) === name) found.push(el);
    find(el.props.children as ReactNode, name, found);
  }
  return found;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_GA_ID = "G-TEST";
  state.headers = new Headers();
});

describe("the root layout and the script nonce", () => {
  it("hands the request's nonce to the theme provider, the consent script and Google Analytics", async () => {
    state.headers = new Headers({ [NONCE_HEADER]: "abc123" });

    const tree = await RootLayout({ children: null });

    expect(find(tree, "ThemeProvider")[0].props.nonce).toBe("abc123");
    expect(find(tree, "Script")[0].props.nonce).toBe("abc123");
    expect(find(tree, "GoogleAnalytics")[0].props.nonce).toBe("abc123");
  });

  it("passes no nonce when the request has none", async () => {
    const tree = await RootLayout({ children: null });

    expect(find(tree, "ThemeProvider")[0].props.nonce).toBeUndefined();
    expect(find(tree, "GoogleAnalytics")[0].props.nonce).toBeUndefined();
  });
});
