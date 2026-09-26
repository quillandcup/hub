// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberNavigation from "@/components/MemberNavigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

async function openMobileDrawer() {
  await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  return screen.getByRole("complementary", { name: "Mobile navigation" });
}

describe("MemberNavigation", () => {
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
});
