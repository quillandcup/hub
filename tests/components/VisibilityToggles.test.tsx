// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarToggle } from "@/components/writing/VisibilityToggles";
import { tooltipText } from "@/tests/helpers/tooltip";

describe("StarToggle", () => {
  it("shows an empty star with a pin tooltip when off", () => {
    render(<StarToggle on={false} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Pin to my dashboard" });
    expect(button).toHaveTextContent("☆");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(tooltipText(button)).toEqual("Pin to my dashboard");
  });

  it("shows a filled star with an unpin tooltip when on, and calls onToggle", async () => {
    const onToggle = vi.fn();
    render(<StarToggle on onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Pin to my dashboard" });
    expect(button).toHaveTextContent("⭐");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(tooltipText(button)).toEqual("Pinned to your dashboard (click to unpin)");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
