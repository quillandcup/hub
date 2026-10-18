// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { AnalyticsIdentity } from "@/components/AnalyticsIdentity";

beforeEach(() => {
  window.gtag = vi.fn();
});

afterEach(() => {
  delete window.gtag;
});

describe("AnalyticsIdentity", () => {
  it("sends nothing for a visitor who never signed in", () => {
    render(<AnalyticsIdentity userId={null} />);
    expect(window.gtag).not.toHaveBeenCalled();
  });

  it("identifies the user on sign-in and clears them on sign-out", () => {
    const { rerender } = render(<AnalyticsIdentity userId={null} />);
    rerender(<AnalyticsIdentity userId="u1" />);
    rerender(<AnalyticsIdentity userId="u1" />);
    rerender(<AnalyticsIdentity userId={null} />);
    expect(window.gtag).toHaveBeenCalledTimes(2);
    expect(window.gtag).toHaveBeenNthCalledWith(1, "set", { user_id: "u1" });
    expect(window.gtag).toHaveBeenNthCalledWith(2, "set", { user_id: null });
  });

  it("leaves a first load that was already signed in to the inline script", () => {
    const { rerender } = render(<AnalyticsIdentity userId="u1" />);
    expect(window.gtag).not.toHaveBeenCalled();
    rerender(<AnalyticsIdentity userId={null} />);
    expect(window.gtag).toHaveBeenCalledWith("set", { user_id: null });
  });
});
