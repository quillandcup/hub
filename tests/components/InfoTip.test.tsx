// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InfoTip } from "@/components/InfoTip";

describe("InfoTip", () => {
  it("takes no room until shown, so it can't widen the page next to the right edge", () => {
    render(<InfoTip>Definition</InfoTip>);
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip).toHaveTextContent("Definition");
    // display:none by default, display:block on hover or focus (not opacity-0, which still lays out)
    expect(tip).toHaveClass("hidden", "group-hover:block", "group-focus-within:block");
    expect(tip).not.toHaveClass("opacity-0");
    // on a phone it spans the viewport instead of hanging 16rem off the icon
    expect(tip).toHaveClass("max-sm:fixed", "max-sm:inset-x-4");
  });

  it("is described by its tip for keyboard and screen reader users, and can hold a link", () => {
    render(<InfoTip interactive label="About aliases"><a href="/x">Manage</a></InfoTip>);
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(screen.getByRole("button", { name: "About aliases" })).toHaveAttribute("aria-describedby", tip.id);
    expect(tip).toHaveClass("pointer-events-auto");
  });
});
