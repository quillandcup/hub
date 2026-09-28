// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/SudoModal", () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="sudo-modal" /> : null),
}));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign out</button> }));
vi.mock("@/components/FeaturePreviewsModal", () => ({ default: () => null }));

import UserMenu from "@/components/UserMenu";

describe("UserMenu sudo modal", () => {
  it("doesn't reopen the sudo modal after sudo starts and then exits", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UserMenu userEmail="admin@example.com" isAdmin />);

    await user.click(screen.getByRole("button", { name: /admin@example\.com/ }));
    await user.click(screen.getByRole("button", { name: "Sudo As..." }));
    expect(screen.getByTestId("sudo-modal")).toBeInTheDocument();

    // The menu lives in the layout, so it stays mounted as sudo starts and exits.
    rerender(<UserMenu userEmail="admin@example.com" isAdmin isSudo />);
    rerender(<UserMenu userEmail="admin@example.com" isAdmin isSudo={false} />);

    expect(screen.queryByTestId("sudo-modal")).not.toBeInTheDocument();
  });
});
