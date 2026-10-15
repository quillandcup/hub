// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { InstallAppPrompt, shareButtonLocation } from "@/components/InstallAppPrompt";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

function device({ ua, standalone = false }: { ua: string; standalone?: boolean }) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  Object.defineProperty(navigator, "standalone", { configurable: true, value: standalone });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("shareButtonLocation", () => {
  it("points at where the Share button is for each device and browser", () => {
    expect(shareButtonLocation(IPHONE_UA, false)).toContain("bottom toolbar");
    expect(shareButtonLocation(IPHONE_UA, true)).toContain("top of the window");
    expect(shareButtonLocation(IPHONE_UA + " CriOS/126.0", false)).toContain("next to the address bar");
  });
});

describe("InstallAppPrompt", () => {
  it("offers to open the share sheet where the browser supports it", async () => {
    device({ ua: IPHONE_UA });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    render(<InstallAppPrompt />);
    await userEvent.click(await screen.findByRole("button", { name: "Open the Share menu" }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: window.location.href }));
    delete (navigator as { share?: unknown }).share;
  });

  it("nudges an iPhone in Safari to add the Hub to the Home Screen, and remembers a dismissal", async () => {
    device({ ua: IPHONE_UA });
    const { unmount } = render(<InstallAppPrompt />);
    expect(await screen.findByText(/Add the Hub to your Home Screen/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText(/Add the Hub to your Home Screen/)).not.toBeInTheDocument();

    unmount();
    render(<InstallAppPrompt />);
    expect(screen.queryByText(/Add the Hub to your Home Screen/)).not.toBeInTheDocument();
  });

  it("stays out of the way once installed, and on other devices", () => {
    device({ ua: IPHONE_UA, standalone: true });
    const { unmount } = render(<InstallAppPrompt />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    unmount();

    device({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" });
    render(<InstallAppPrompt />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
