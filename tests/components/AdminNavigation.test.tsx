// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import MobileMenuButton from "@/components/MobileMenuButton";
import AdminNavigation from "@/app/(admin)/admin/AdminNavigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

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
