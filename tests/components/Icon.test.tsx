// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Icon, { ICONS, type IconName } from "@/components/Icon";

describe("Icon", () => {
  it("draws every named icon, hidden from assistive tech", () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg")!;
      expect(svg, name).toHaveAttribute("aria-hidden", "true");
      expect(svg.querySelector("path, circle, rect, line, polyline"), name).not.toBeNull();
      unmount();
    }
  });

  it("is 16px unless told otherwise, and takes a class", () => {
    const { container, rerender } = render(<Icon name="reset" />);
    expect(container.querySelector("svg")).toHaveClass("h-4", "w-4");
    rerender(<Icon name="reset" className="h-6 w-6" />);
    expect(container.querySelector("svg")).toHaveClass("h-6", "w-6");
    expect(container.querySelector("svg")).not.toHaveClass("h-4");
  });

  it("gives each meaning its own picture, so two meanings never look the same by accident", () => {
    const pictures = new Map<unknown, string>();
    for (const [name, glyph] of Object.entries(ICONS)) {
      expect(pictures.get(glyph), `${name} duplicates ${pictures.get(glyph)}`).toBeUndefined();
      pictures.set(glyph, name);
    }
  });
});
