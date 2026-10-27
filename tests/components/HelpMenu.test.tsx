// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HelpMenu from "@/components/HelpMenu";
import AppHeader from "@/components/AppHeader";

vi.mock("@/components/MobileMenuButton", () => ({ default: () => null }));
vi.mock("@/components/search/SearchPalette", () => ({ default: () => null }));
vi.mock("@/components/LiveRoomIndicator", () => ({ default: () => null }));
vi.mock("@/components/InAppNotifications", () => ({ InAppNotificationBanner: () => null, InAppNotificationBell: () => <button>Notifications</button> }));
vi.mock("html-to-image", () => ({ toBlob: vi.fn().mockResolvedValue(null) }));

describe("HelpMenu", () => {
  it("lists Hedgie Help and Send feedback when opened", async () => {
    render(<HelpMenu />);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("menuitem", { name: "Hedgie Help" })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("menuitem", { name: "Send feedback" })).toBeInTheDocument();
  });

  it("closes on Escape and on an outside click", async () => {
    render(<HelpMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the feedback form and closes the menu", async () => {
    render(<HelpMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Send feedback" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByPlaceholderText("What's going on?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByPlaceholderText("What's going on?")).toBeNull();
  });
});

describe("AppHeader help menu", () => {
  it.each([false, true])("sits just before the notification bell (admin: %s)", (isAdmin) => {
    render(<AppHeader resultsPath="/search" isAdmin={isAdmin}><span>menu</span></AppHeader>);
    const help = screen.getByRole("button", { name: "Help" });
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(help.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
