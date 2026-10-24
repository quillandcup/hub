// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HelpLink from "@/components/HelpLink";
import AppHeader from "@/components/AppHeader";

vi.mock("@/components/MobileMenuButton", () => ({ default: () => null }));
vi.mock("@/components/search/SearchPalette", () => ({ default: () => null }));
vi.mock("@/components/LiveRoomIndicator", () => ({ default: () => null }));
vi.mock("@/components/InAppNotifications", () => ({ InAppNotificationBanner: () => null, InAppNotificationBell: () => <button>Notifications</button> }));

describe("HelpLink", () => {
  it("is a link to the help pages, named for screen readers", () => {
    render(<HelpLink href="/help" />);
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
  });
});

describe("AppHeader help button", () => {
  it("sits just before the notification bell when a help address is given", () => {
    render(<AppHeader resultsPath="/search" isAdmin={false} helpHref="/help"><span>menu</span></AppHeader>);
    const help = screen.getByRole("link", { name: "Help" });
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(help.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves it out where there is no help address, as in the admin area", () => {
    render(<AppHeader resultsPath="/admin/search" isAdmin><span>menu</span></AppHeader>);
    expect(screen.queryByRole("link", { name: "Help" })).toBeNull();
  });
});
