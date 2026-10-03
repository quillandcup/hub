// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/SudoModal", () => ({ default: () => null }));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign out</button> }));
vi.mock("@/components/FeaturePreviewsModal", () => ({ default: () => null }));
vi.mock("@/app/actions/onboarding", () => ({ startOnboarding: vi.fn().mockResolvedValue({ success: true }) }));

import UserMenu from "@/components/UserMenu";
import { startOnboarding } from "@/app/actions/onboarding";

describe("UserMenu Take the tour", () => {
  it("starts the onboarding tour when the flag allows it", async () => {
    const user = userEvent.setup();
    render(<UserMenu userEmail="Member One" canStartOnboarding />);

    await user.click(screen.getByRole("button", { name: /Member One/ }));
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(startOnboarding).toHaveBeenCalled();
  });

  it("hides the entry otherwise (flag off, or sudo)", async () => {
    const user = userEvent.setup();
    render(<UserMenu userEmail="Member One" />);

    await user.click(screen.getByRole("button", { name: /Member One/ }));
    expect(screen.queryByRole("button", { name: "Take the tour" })).not.toBeInTheDocument();
  });
});
