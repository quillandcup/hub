// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StaffPage } from "@/components/trust/StaffView";

describe("StaffPage", () => {
  it("frames a staff trust page like the other admin pages: padded, centred, a readable width, with the title first", () => {
    const { container } = render(
      <StaffPage title="Security">
        <p>Body</p>
      </StaffPage>,
    );
    const frame = container.firstElementChild as HTMLElement;
    // The same container the other admin pages use (container mx-auto px-6 py-8 max-w-5xl); a bare max-w-5xl left the text against the sidebar.
    for (const cls of ["container", "mx-auto", "px-6", "py-8", "max-w-5xl"]) expect(frame).toHaveClass(cls);
    expect(screen.getByRole("heading", { level: 1, name: "Security" })).toBeInTheDocument();
    expect(frame.firstElementChild).toBe(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});
