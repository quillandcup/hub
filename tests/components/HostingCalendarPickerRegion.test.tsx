// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import HostingCalendarPicker from "@/app/(member)/hosting/HostingCalendarPicker";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/my-prickles/hosting" }));
vi.mock("@/app/(member)/hosting/actions", () => ({
  getHostingCalendarContext: vi.fn(async () => ({ prickles: [], proposedSlots: [] })),
}));

describe("HostingCalendarPicker scrolling area", () => {
  it("can be reached and scrolled with the keyboard, and is named", async () => {
    render(<HostingCalendarPicker month="2026-11-01" onPick={vi.fn()} />);
    const region = await waitFor(() => screen.getByRole("region", { name: "Week calendar" }));
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-auto");
  });
});
