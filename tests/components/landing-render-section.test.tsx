// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("LandingRender with a Section", () => {
  it("renders the blocks stored inside a section (a slot must be declared for the public render)", async () => {
    // Puck's client entry needs ResizeObserver when it loads, so it is imported after the stub.
    globalThis.ResizeObserver = ResizeObserverStub as never;
    const { default: LandingRender } = await import("@/components/landing/LandingRender");
    const data = {
      content: [
        {
          type: "Section",
          props: { id: "s1", background: "white", overlay: "none", width: "narrow", align: "center", card: false, fadeIn: false, content: [{ type: "Heading", props: { id: "h1", text: "Inside the section", level: "h1", align: "center" } }] },
        },
      ],
      root: { props: {} },
    };
    render(<LandingRender data={data} />);
    expect(screen.getByRole("heading", { level: 1, name: "Inside the section" })).toBeInTheDocument();
  });

  it("lays the blocks on the section's 12-column grid with the widths they were given, and no editor attribute reaches the page", async () => {
    globalThis.ResizeObserver = ResizeObserverStub as never;
    const { default: LandingRender } = await import("@/components/landing/LandingRender");
    const heading = (id: string, extra: Record<string, unknown>) => ({ type: "Heading", props: { id, text: `Heading ${id}`, level: "h2", align: "left", ...extra } });
    const data = {
      content: [
        {
          type: "Section",
          props: {
            id: "s1", background: "none", overlay: "none", width: "wide", align: "left", card: false, fadeIn: false,
            paddingDesktop: { top: 70, bottom: 70, left: 10, right: 10 }, paddingMobile: { top: 20, bottom: 20, left: 5, right: 5 }, hideOnDesktop: false, hideOnMobile: true,
            content: [heading("a", { span: 8, spanMobile: 12 }), heading("b", { span: 4, spanMobile: 6 }), heading("c", {})],
          },
        },
      ],
      root: { props: {} },
    };
    const { container } = render(<LandingRender data={data} />);
    const section = container.querySelector("section")!;
    expect(section.style.getPropertyValue("--sp-t-d")).toBe("70px");
    expect(section.style.getPropertyValue("--sp-l-m")).toBe("5px");
    expect(section.className).toContain("hidden @split:block");
    const grid = container.querySelector(".grid-cols-12")!;
    expect(grid.outerHTML).not.toMatch(/collision/i);
    const boxes = [...grid.children] as HTMLElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes[0].className).toContain("@split:col-span-8");
    expect(boxes[0].className).toContain("col-span-12");
    expect(boxes[1].className).toContain("@split:col-span-4");
    expect(boxes[1].className).toContain("col-span-6");
    expect(boxes[2].className).toContain("@split:col-span-12");
    expect(boxes[1].querySelector("h2")).toHaveTextContent("Heading b");
  });
});
