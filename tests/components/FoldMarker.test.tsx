// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ height: "auto" as number | "auto" }));

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => (select: (state: unknown) => unknown) => select({ appState: { ui: { viewports: { current: { width: 402, height: mocks.height } } } } }),
}));

import { FoldContext, FoldFrame, FoldMarker } from "@/app/(admin)/admin/pages/[slug]/FoldMarker";

afterEach(cleanup);

describe("the fold line", () => {
  it("is drawn at the viewport height with its label", () => {
    const { container } = render(<FoldMarker height={874} visible />);
    const line = container.querySelector("[data-fold-marker]") as HTMLElement;
    expect(line.style.top).toBe("874px");
    expect(screen.getByText("Fold: 874px")).toBeTruthy();
  });

  it("is not drawn at desktop (auto height) or when hidden", () => {
    expect(render(<FoldMarker height="auto" visible />).container.querySelector("[data-fold-marker]")).toBeNull();
    expect(render(<FoldMarker height={874} visible={false} />).container.querySelector("[data-fold-marker]")).toBeNull();
  });

  it("follows the canvas height inside the frame, and the visibility switch", () => {
    mocks.height = 1180;
    const on = render(<FoldFrame><p>page</p></FoldFrame>);
    expect(screen.getByText("page")).toBeTruthy();
    expect(screen.getByText("Fold: 1180px")).toBeTruthy();
    on.unmount();

    render(
      <FoldContext.Provider value={{ visible: false, setVisible: () => {} }}>
        <FoldFrame><p>page</p></FoldFrame>
      </FoldContext.Provider>,
    );
    expect(screen.queryByText(/Fold:/)).toBeNull();

    mocks.height = "auto";
  });
});
