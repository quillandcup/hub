// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Icon, { ICONS } from "@/components/Icon";

describe("Icon", () => {
  it("draws a named icon, hidden from assistive tech", () => {
    const { container } = render(<Icon name="trash" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.querySelector("path")).toHaveAttribute("d", ICONS.trash);
  });

  it("draws a raw path and takes a class", () => {
    const { container } = render(<Icon path="M0 0" className="h-6 w-6" />);
    expect(container.querySelector("path")).toHaveAttribute("d", "M0 0");
    expect(container.querySelector("svg")).toHaveClass("h-6");
  });

  it("draws nothing when given neither", () => {
    const { container } = render(<Icon />);
    expect(container.querySelector("path")).toHaveAttribute("d", "");
  });
});
