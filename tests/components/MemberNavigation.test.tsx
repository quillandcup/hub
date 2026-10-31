// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MobileMenuButton from "@/components/MobileMenuButton";
import MemberNavigation from "@/components/MemberNavigation";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

const updateNavMode = vi.fn(async (_mode: string): Promise<{ success?: boolean; error?: string }> => ({ success: true }));
vi.mock("@/app/(member)/settings/actions", () => ({ updateNavMode: (mode: string) => updateNavMode(mode) }));

beforeEach(() => {
  updateNavMode.mockClear();
  pathname = "/dashboard";
});

async function openMobileDrawer() {
  render(<MobileMenuButton />);
  await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  return screen.getByRole("complementary", { name: "Mobile navigation" });
}

describe("MemberNavigation", () => {
  it("is unmasked in Session Replay, so recordings show which page was opened", () => {
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(sidebar.querySelector("nav")).toHaveAttribute("data-sentry-unmask");
  });

  it("shows Chat only when the chat feature is on, and marks it active on its pages", () => {
    const { rerender } = render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const sidebar = () => screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(within(sidebar()).queryByRole("link", { name: /Chat/ })).not.toBeInTheDocument();

    pathname = "/chat/00000000-0000-4000-a000-000000000001";
    rerender(<MemberNavigation isAdmin={false} enabledFeatures={["chat"]} />);
    // On chat the sidebar rests as an icon rail, so the link is found by its title.
    const link = within(sidebar()).getByTitle("Chat").closest("a")!;
    expect(link).toHaveAttribute("href", "/chat");
    expect(link.className).toContain("text-plum-600");
  });

  it("shows the Admin Portal link in the mobile drawer for admins", async () => {
    render(<MemberNavigation isAdmin={true} enabledFeatures={[]} />);
    const drawer = await openMobileDrawer();
    expect(within(drawer).getByRole("link", { name: /Admin Portal/ })).toHaveAttribute("href", "/admin");
  });

  it("shows the Admin Portal link in the desktop sidebar for admins", () => {
    render(<MemberNavigation isAdmin={true} enabledFeatures={[]} />);
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(within(sidebar).getByRole("link", { name: /Admin Portal/ })).toHaveAttribute("href", "/admin");
  });

  it("does not show the Admin Portal link to non-admins on mobile or desktop", async () => {
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const drawer = await openMobileDrawer();
    expect(within(drawer).queryByRole("link", { name: /Admin Portal/ })).not.toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(within(sidebar).queryByRole("link", { name: /Admin Portal/ })).not.toBeInTheDocument();
  });

  it("sizes the mobile drawer to the visible viewport, not 100vh, so the bottom Admin link stays on screen", async () => {
    render(<MemberNavigation isAdmin={true} enabledFeatures={[]} />);
    const drawer = await openMobileDrawer();
    expect(drawer).toHaveClass("fixed", "inset-y-0");
    expect(drawer).not.toHaveClass("h-screen");
  });

  it("renders the same primary links in the mobile drawer and the desktop sidebar", async () => {
    render(<MemberNavigation isAdmin={true} enabledFeatures={["events"]} />);
    const drawer = await openMobileDrawer();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    const hrefs = (el: HTMLElement) => within(el).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs(drawer)).toEqual(hrefs(sidebar));
    expect(hrefs(drawer)).toContain("/admin");
  });

  // Streaks and Wheel of Wonder were feature-flagged; they're now on for everyone.
  it("shows Streaks and Wheel of Wonder with no feature previews enabled", async () => {
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const drawer = await openMobileDrawer();
    expect(within(drawer).getByRole("link", { name: /Streaks/ })).toHaveAttribute("href", "/streaks");
    expect(within(drawer).getByRole("link", { name: /Wheel of Wonder/ })).toHaveAttribute("href", "/wheel-of-wonder");
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    const sidebarHrefs = within(sidebar).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(sidebarHrefs).toEqual(expect.arrayContaining(["/streaks", "/wheel-of-wonder"]));
  });

  // Calendar, Prickle Picker and Hosting are now My Prickles tabs (no standalone routes).
  it.each(["/my-prickles", "/prickles/prickle-1"])("highlights My Prickles at %s", (path) => {
    pathname = path;
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(within(sidebar).getByRole("link", { name: /Prickles/ })).toHaveClass("font-medium");
    expect(within(sidebar).getByRole("link", { name: /Dashboard/ })).not.toHaveClass("font-medium");
  });

  it("does not highlight My Prickles on unrelated pages", () => {
    pathname = "/projects";
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(within(sidebar).getByRole("link", { name: /Prickles/ })).not.toHaveClass("font-medium");
  });
});

describe("MemberNavigation drawer and keyboard focus", () => {
  it("takes the closed drawer out of the tab order and the accessibility tree, and puts it back when opened", async () => {
    render(
      <>
        <MobileMenuButton />
        <MemberNavigation isAdmin={false} enabledFeatures={[]} />
      </>
    );
    const drawer = () => document.querySelector('aside[aria-label="Mobile navigation"]') as HTMLElement;
    expect(drawer()).toHaveAttribute("aria-hidden", "true");
    expect(drawer()).toHaveAttribute("inert");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(drawer()).toHaveAttribute("aria-hidden", "false");
    expect(drawer()).not.toHaveAttribute("inert");
  });
});

describe("MemberNavigation auto-hide on chat", () => {
  const sidebar = () => screen.getByRole("complementary", { name: "Sidebar navigation" });

  it("rests as a rail on chat, opens over the page after a short hover, and closes on leave", () => {
    vi.useFakeTimers();
    try {
      pathname = "/chat/chan-1";
      render(<MemberNavigation isAdmin={false} enabledFeatures={["chat"]} />);
      expect(sidebar()).toHaveAttribute("data-auto-hide", "true");
      expect(sidebar()).toHaveClass("w-16");
      expect(screen.queryByRole("button", { name: /sidebar/i })).not.toBeInTheDocument();

      fireEvent.mouseEnter(sidebar().parentElement!);
      expect(sidebar()).toHaveClass("w-16");
      act(() => { vi.advanceTimersByTime(200); });
      expect(sidebar()).toHaveClass("w-64", "absolute");
      expect(within(sidebar()).getByText("Chat")).toBeInTheDocument();
      // Above the app header (z-30), or its search box covers the wordmark.
      expect(sidebar().parentElement).toHaveClass("z-40");

      fireEvent.mouseLeave(sidebar().parentElement!);
      expect(sidebar()).toHaveClass("w-16");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps headings and labels mounted, on one line, so the list doesn't shift as the rail opens", () => {
    pathname = "/chat";
    render(<MemberNavigation isAdmin={false} enabledFeatures={["chat"]} />);
    const heading = within(sidebar()).getAllByRole("heading", { hidden: true })[0];
    expect(heading).toHaveClass("whitespace-nowrap", "opacity-0");
    expect(sidebar()).toHaveClass("overflow-hidden");
    expect(within(sidebar()).getByText("Quill", { exact: false })).toHaveClass("whitespace-nowrap", "opacity-0");

    act(() => { within(sidebar()).getAllByRole("link")[0].focus(); });
    expect(heading).toHaveClass("opacity-100");
  });

  it("opens when focus moves into the rail", () => {
    pathname = "/chat";
    render(<MemberNavigation isAdmin={false} enabledFeatures={["chat"]} />);
    act(() => { within(sidebar()).getAllByRole("link")[0].focus(); });
    expect(sidebar()).toHaveClass("w-64");
  });

  it("keeps the manual collapse button and no auto-hide elsewhere", () => {
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    expect(sidebar()).not.toHaveAttribute("data-auto-hide");
    expect(screen.getByRole("button", { name: /sidebar/i })).toBeInTheDocument();
  });

  it("cycles pinned open, auto-hide, pinned closed from the header button and saves each choice", async () => {
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const toggle = () => screen.getByRole("button", { name: /^Sidebar/ });

    await userEvent.click(toggle());
    expect(sidebar()).toHaveAttribute("data-auto-hide", "true");
    expect(updateNavMode).toHaveBeenLastCalledWith("auto");

    // Auto-hide rests as a rail with no button; hover opens it, and the button is there to pin it closed.
    expect(screen.queryByRole("button", { name: /^Sidebar/ })).not.toBeInTheDocument();
    fireEvent.focus(within(sidebar()).getAllByRole("link")[0]);
    await userEvent.click(toggle());
    expect(updateNavMode).toHaveBeenLastCalledWith("closed");
    expect(sidebar()).not.toHaveAttribute("data-auto-hide");
    expect(sidebar()).toHaveClass("w-16");

    await userEvent.click(toggle());
    expect(updateNavMode).toHaveBeenLastCalledWith("open");
    expect(sidebar()).toHaveClass("w-64");
  });

  it("uses the saved mode over the page's default, and falls back when saving fails", async () => {
    pathname = "/chat";
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} navMode="open" />);
    expect(sidebar()).not.toHaveAttribute("data-auto-hide");
    expect(sidebar()).toHaveClass("w-64");

    updateNavMode.mockResolvedValueOnce({ error: "nope" });
    await userEvent.click(screen.getByRole("button", { name: /^Sidebar/ }));
    await vi.waitFor(() => expect(sidebar()).not.toHaveAttribute("data-auto-hide"));
  });
});
