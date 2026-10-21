// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SplitButton from "@/app/(admin)/admin/members/[id]/SplitButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("SplitButton", () => {
  it("opens the split modal and closes it on cancel", async () => {
    render(<SplitButton member={{ id: "m1", name: "Wren Holloway", email: "wren@example.com" }} nameAliases={[]} emailAliases={[]} />);
    expect(screen.queryByText("Split Out a Merged Member")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(screen.getByText("Split Out a Merged Member")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Split Out a Merged Member")).not.toBeInTheDocument();
  });
});
