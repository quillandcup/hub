// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const stopRolePreview = vi.hoisted(() => vi.fn(async () => "/admin"));
vi.mock("@/app/actions/staff-preview", () => ({ stopRolePreview }));

import RolePreviewBanner from "@/components/RolePreviewBanner";

describe("RolePreviewBanner", () => {
  it("names the previewed role and leaves the preview with a full page load", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<RolePreviewBanner roleLabel="Community Manager" />);
    expect(screen.getByText("Community Manager")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(stopRolePreview).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/admin");
  });
});
