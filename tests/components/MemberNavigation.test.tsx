// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberNavigation from "@/components/MemberNavigation";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

beforeEach(() => {
  pathname = "/dashboard";
});

async function openMobileDrawer() {
  await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  return screen.getByRole("complementary", { name: "Mobile navigation" });
}

describe("MemberNavigation", () => {
  it("shows Chat only when the chat feature is on, and marks it active on its pages", () => {
    const { rerender } = render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const sidebar = () => screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(within(sidebar()).queryByRole("link", { name: /Chat/ })).not.toBeInTheDocument();

    pathname = "/chat/00000000-0000-4000-a000-000000000001";
    rerender(<MemberNavigation isAdmin={false} enabledFeatures={["chat"]} />);
    const link = within(sidebar()).getByRole("link", { name: /Chat/ });
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
    expect(within(sidebar).getByRole("link", { name: /My Prickles/ })).toHaveClass("font-medium");
    expect(within(sidebar).getByRole("link", { name: /Dashboard/ })).not.toHaveClass("font-medium");
  });

  it("does not highlight My Prickles on unrelated pages", () => {
    pathname = "/projects";
    render(<MemberNavigation isAdmin={false} enabledFeatures={[]} />);
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(within(sidebar).getByRole("link", { name: /My Prickles/ })).not.toHaveClass("font-medium");
  });
});
