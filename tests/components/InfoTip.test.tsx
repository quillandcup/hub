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
});
