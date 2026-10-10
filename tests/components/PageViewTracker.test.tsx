// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { PAGE_VIEW_PATH } from "@/lib/page-views";

let mockPathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

import PageViewTracker from "@/components/PageViewTracker";

beforeEach(() => {
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
    expect(JSON.parse(init.body)).toEqual({ path: "/dashboard" });
  });

  it("reports again when the pathname changes", () => {
    const { rerender } = render(<PageViewTracker />);
    mockPathname = "/members";
    rerender(<PageViewTracker />);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetch as any).mock.calls[1][1].body)).toEqual({ path: "/members" });
  });

  it("swallows a failed report", () => {
    (fetch as any).mockRejectedValue(new Error("offline"));
    expect(() => render(<PageViewTracker />)).not.toThrow();
  });
});
