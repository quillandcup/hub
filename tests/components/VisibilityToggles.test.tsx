// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarToggle, ProfileVisibilityToggle } from "@/components/writing/VisibilityToggles";

describe("StarToggle", () => {
  it("shows an empty star with a pin tooltip when off", () => {
    render(<StarToggle on={false} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Pin to my dashboard" });
    expect(button).toHaveTextContent("☆");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Pin to my dashboard");
  });

  it("shows a filled star with an unpin tooltip when on, and calls onToggle", async () => {
    const onToggle = vi.fn();
    render(<StarToggle on onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Pin to my dashboard" });
    expect(button).toHaveTextContent("⭐");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Pinned to your dashboard (click to unpin)");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("ProfileVisibilityToggle", () => {
  it("shows a lock and says only you can see it when private", () => {
    render(<ProfileVisibilityToggle on={false} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Show on my profile" });
    expect(button).toHaveTextContent("🔒");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Only you can see this goal (click to show on your profile)");
  });

  it("shows a globe and says other members can see it when public", async () => {
    const onToggle = vi.fn();
    render(<ProfileVisibilityToggle on onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Show on my profile" });
    expect(button).toHaveTextContent("🌐");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Visible on your profile to other members (click to hide)");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("adds a text label and uses the given noun for the project-level toggle", () => {
    render(<ProfileVisibilityToggle on={false} onToggle={() => {}} noun="project" withText />);
    const button = screen.getByRole("button", { name: "Show on my profile" });
    expect(button).toHaveTextContent("Only me");
    expect(button).toHaveAttribute("title", "Only you can see this project (click to show on your profile)");
  });

  it("doesn't fire while disabled", async () => {
    const onToggle = vi.fn();
    render(<ProfileVisibilityToggle on={false} onToggle={onToggle} disabled />);
    await userEvent.click(screen.getByRole("button", { name: "Show on my profile" }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
