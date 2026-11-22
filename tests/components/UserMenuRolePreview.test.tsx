// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const startRolePreview = vi.hoisted(() => vi.fn(async (_role: string) => undefined));

vi.mock("@/app/actions/staff-preview", () => ({ startRolePreview }));
vi.mock("@/components/SudoModal", () => ({ default: () => null }));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign out</button> }));

import UserMenu from "@/components/UserMenu";
import { PREVIEWABLE_ROLES, PREVIEW_ROLE_LABELS } from "@/lib/staff-preview";

describe("UserMenu Preview as", () => {
  beforeEach(() => startRolePreview.mockClear());

  const open = async () => userEvent.click(screen.getByRole("button", { name: /admin@example\.com/ }));

  it("offers one Preview as entry to a real admin, which opens a picker listing every previewable role", async () => {
    render(<UserMenu userEmail="admin@example.com" isAdmin canPreviewRole />);
    await open();
    expect(screen.getAllByRole("button", { name: /^Preview as/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Preview as..." }));

    const dialog = screen.getByRole("dialog", { name: "Preview as" });
    const options = within(dialog).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(PREVIEWABLE_ROLES.map((role) => PREVIEW_ROLE_LABELS[role]));
    expect(options).toEqual(expect.arrayContaining(["Community Manager", "Conversion Specialist"]));
  });

  it("starts the preview of the role that was picked, with a button named for the action", async () => {
    render(<UserMenu userEmail="admin@example.com" isAdmin canPreviewRole />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Preview as..." }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "conversion_specialist");
    await userEvent.click(screen.getByRole("button", { name: "Start preview" }));
    expect(startRolePreview).toHaveBeenCalledWith("conversion_specialist");
  });

  it("closes without starting anything on Cancel", async () => {
    render(<UserMenu userEmail="admin@example.com" isAdmin canPreviewRole />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Preview as..." }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(startRolePreview).not.toHaveBeenCalled();
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
