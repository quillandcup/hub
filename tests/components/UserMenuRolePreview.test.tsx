// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const startRolePreview = vi.hoisted(() => vi.fn(async (_role: string) => undefined));
vi.mock("@/app/actions/staff-preview", () => ({ startRolePreview }));
vi.mock("@/components/SudoModal", () => ({ default: () => null }));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign out</button> }));

import UserMenu from "@/components/UserMenu";

describe("UserMenu role preview", () => {
  const open = async () => userEvent.click(screen.getByRole("button", { name: /admin@example\.com/ }));

  it("offers a preview of each previewable role to a real admin", async () => {
    render(<UserMenu userEmail="admin@example.com" isAdmin canPreviewRole />);
    await open();
    expect(screen.getByRole("button", { name: "Preview as Community Manager" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview as Conversion Specialist" })).toBeInTheDocument();
  });

  it("starts the preview of the role that was picked", async () => {
    render(<UserMenu userEmail="admin@example.com" isAdmin canPreviewRole />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Preview as Conversion Specialist" }));
    expect(startRolePreview).toHaveBeenCalledTimes(1);
    expect(startRolePreview.mock.calls[0][0]).toBe("conversion_specialist");
  });

  it("offers no preview to anyone else, or during sudo", async () => {
    const { unmount } = render(<UserMenu userEmail="admin@example.com" />);
    await open();
    expect(screen.queryByRole("button", { name: /^Preview as/ })).not.toBeInTheDocument();
    unmount();

    render(<UserMenu userEmail="admin@example.com" isAdmin canPreviewRole isSudo />);
    await open();
    expect(screen.queryByRole("button", { name: /^Preview as/ })).not.toBeInTheDocument();
  });
});
