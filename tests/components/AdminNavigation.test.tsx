// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import MobileMenuButton from "@/components/MobileMenuButton";
import AdminNavigation from "@/app/(admin)/admin/AdminNavigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));
const updateNavMode = vi.fn(async (_mode: string): Promise<{ success?: boolean; error?: string }> => ({ success: true }));
vi.mock("@/app/(member)/settings/actions", () => ({ updateNavMode: (mode: string) => updateNavMode(mode) }));

describe("AdminNavigation", () => {
  it("opens the mobile drawer from the hamburger in the page header, and closes it again", async () => {
    render(
      <>
        <MobileMenuButton />
        <AdminNavigation enabledFeatures={[]} />
      </>
    );
    // The drawer is aria-hidden until opened, so its close button isn't in the accessibility tree.
    expect(screen.queryByRole("button", { name: "Close navigation menu" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));

    expect(screen.queryByRole("button", { name: "Close navigation menu" })).not.toBeInTheDocument();
  });
});

describe("AdminNavigation drawer and keyboard focus", () => {
  it("takes the closed drawer out of the tab order and the accessibility tree, and puts it back when opened", async () => {
    render(
      <>
        <MobileMenuButton />
        <AdminNavigation enabledFeatures={[]} />
      </>
    );
    const drawer = () => document.querySelector("aside.fixed") as HTMLElement;
    expect(drawer()).toHaveAttribute("aria-hidden", "true");
    expect(drawer()).toHaveAttribute("inert");

    await userEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(drawer()).toHaveAttribute("aria-hidden", "false");
    expect(drawer()).not.toHaveAttribute("inert");
  });
});

describe("AdminNavigation sidebar mode", () => {
  const sidebar = () => screen.getByRole("complementary", { name: "Sidebar navigation" });

  it("is pinned open by default and cycles to auto-hide, closed and back, saving each choice", async () => {
    updateNavMode.mockClear();
    render(<AdminNavigation enabledFeatures={[]} />);
    expect(sidebar()).toHaveClass("w-64");

    await userEvent.click(screen.getByRole("button", { name: /^Sidebar/ }));
    expect(updateNavMode).toHaveBeenLastCalledWith("auto");
    expect(sidebar()).toHaveAttribute("data-auto-hide", "true");
    expect(sidebar()).toHaveClass("w-16", "overflow-hidden");
    // At rest the labels are still mounted, on one line and hidden, so nothing shifts when it opens.
    expect(within(sidebar()).getByText("My View")).toHaveClass("whitespace-nowrap", "opacity-0");

    fireEvent.focus(within(sidebar()).getAllByRole("link")[0]);
    expect(sidebar()).toHaveClass("w-64");
    await userEvent.click(screen.getByRole("button", { name: /^Sidebar/ }));
    expect(updateNavMode).toHaveBeenLastCalledWith("closed");
    expect(sidebar()).toHaveClass("w-16");

    await userEvent.click(screen.getByRole("button", { name: /^Sidebar/ }));
    expect(updateNavMode).toHaveBeenLastCalledWith("open");
    expect(sidebar()).toHaveClass("w-64");
  });

  it("starts in the saved mode", () => {
    render(<AdminNavigation enabledFeatures={[]} navMode="auto" />);
    expect(sidebar()).toHaveAttribute("data-auto-hide", "true");
  });

  it("keeps folded sections folded in auto-hide, with the same rows at rest and open", () => {
    render(<AdminNavigation enabledFeatures={[]} navMode="auto" />);
    const folds = () => Array.from(sidebar().querySelectorAll("details"));
    const rows = () => sidebar().querySelectorAll("summary, h2, li").length;

    const atRest = rows();
    expect(folds().length).toBeGreaterThan(0);
    expect(folds().every((d) => !d.open)).toBe(true);
    expect(folds()[0].querySelector("summary")).toHaveClass("opacity-0", "pointer-events-none");

    fireEvent.focus(within(sidebar()).getAllByRole("link")[0]);
    expect(rows()).toBe(atRest);
    expect(folds().every((d) => !d.open)).toBe(true);
    expect(folds()[0].querySelector("summary")).toHaveClass("opacity-100");
  });
});
