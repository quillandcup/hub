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
