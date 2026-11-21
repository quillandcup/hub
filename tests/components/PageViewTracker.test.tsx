// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { PAGE_VIEW_PATH } from "@/lib/page-views";

let mockPathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

import PageViewTracker from "@/components/PageViewTracker";

const GA_ID = "G-TEST123";
const w = window as unknown as { dataLayer?: unknown[]; google_tag_manager?: Record<string, unknown> };

function consent(action: string, analytics_storage: string) {
  (function (..._a: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer ??= []).push(arguments);
  })("consent", action, { analytics_storage });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  delete w.dataLayer;
  delete w.google_tag_manager;
  mockPathname = "/dashboard";
  global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
});

describe("PageViewTracker", () => {
  it("reports the current path once on mount", () => {
    const { rerender } = render(<PageViewTracker />);
    rerender(<PageViewTracker />);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe(PAGE_VIEW_PATH);
    expect(JSON.parse(init.body)).toEqual({ path: "/dashboard", ga_tag: "not_applicable" });
  });

  it("reports again when the pathname changes", () => {
    const { rerender } = render(<PageViewTracker />);
    mockPathname = "/members";
    rerender(<PageViewTracker />);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetch as any).mock.calls[1][1].body)).toEqual({ path: "/members", ga_tag: "not_applicable" });
  });

  it("swallows a failed report", () => {
    (fetch as any).mockRejectedValue(new Error("offline"));
    expect(() => render(<PageViewTracker />)).not.toThrow();
  });

  describe("Google tag signal", () => {
    const body = () => JSON.parse((fetch as any).mock.calls[0][1].body);
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubEnv("NEXT_PUBLIC_GA_ID", GA_ID);
      consent("default", "granted");
    });
    afterEach(() => vi.useRealTimers());

    it("sends tag_running at once when the tag is running", () => {
      w.google_tag_manager = { [GA_ID]: {} };
      render(<PageViewTracker />);
      expect(body()).toEqual({ path: "/dashboard", ga_tag: "tag_running" });
    });

    it("waits for a slow tag and then sends tag_running, in a single report", () => {
      render(<PageViewTracker />);
      expect(fetch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      w.google_tag_manager = { [GA_ID]: {} };
      vi.advanceTimersByTime(250);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(body().ga_tag).toBe("tag_running");
    });

    it("sends not_loaded when the tag never runs", () => {
      render(<PageViewTracker />);
      vi.advanceTimersByTime(10_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(body()).toEqual({ path: "/dashboard", ga_tag: "not_loaded" });
    });

    it("sends not_applicable when analytics is denied (consent or opt-out)", () => {
      consent("update", "denied");
      render(<PageViewTracker />);
      expect(body().ga_tag).toBe("not_applicable");
    });

    it("sends a view that is still waiting when the page is left, or the member navigates on", () => {
      const { rerender, unmount } = render(<PageViewTracker />);
      mockPathname = "/members";
      rerender(<PageViewTracker />);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(body()).toEqual({ path: "/dashboard", ga_tag: "not_loaded" });
      window.dispatchEvent(new Event("pagehide"));
      expect(fetch).toHaveBeenCalledTimes(2);
      unmount();
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
