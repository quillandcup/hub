// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CONSENT_STORAGE_KEY } from "@/lib/analytics/consent";
import { ConsentBanner } from "@/components/ConsentBanner";

let gtag: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

beforeEach(() => {
  localStorage.clear();
  gtag = vi.fn<(...args: unknown[]) => void>();
  window.gtag = gtag;
});

afterEach(() => {
  delete window.gtag;
});

describe("ConsentBanner", () => {
  it("asks visitors who need to be asked, and not others", () => {
    const { unmount } = render(<ConsentBanner needsConsent={true} />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
    unmount();
    render(<ConsentBanner needsConsent={false} />);
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });

  it("re-applies a stored choice instead of asking again", () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
    render(<ConsentBanner needsConsent={true} />);
    expect(gtag).toHaveBeenCalledWith("consent", "update", { analytics_storage: "granted", ad_storage: "granted" });
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });

  it("keeps Google Analytics denied and asks nothing for a member who left usage statistics", () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
    render(<ConsentBanner needsConsent={true} optedOut />);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("consent", "update", { analytics_storage: "denied", ad_storage: "denied" });
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });
});
