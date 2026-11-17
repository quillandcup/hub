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
          props: { id: "s1", background: "white", overlay: "none", width: "narrow", padding: "medium", align: "center", card: false, fadeIn: false, content: [{ type: "Heading", props: { id: "h1", text: "Inside the section", level: "h1", align: "center" } }] },
        },
      ],
      root: { props: {} },
    };
    render(<LandingRender data={data} />);
    expect(screen.getByRole("heading", { level: 1, name: "Inside the section" })).toBeInTheDocument();
  });
});
