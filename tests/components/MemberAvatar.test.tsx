// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";

describe("MemberAvatar", () => {
  it("loads its photo lazily and decodes it off the main thread, so an off-screen avatar is not preloaded", () => {
    const { container } = render(<MemberAvatar name="Ada Example" photoUrl="https://example.com/a.png" />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("falls back to initials when there is no photo or it fails to load", () => {
    const { container, rerender } = render(<MemberAvatar name="Ada Example" photoUrl={null} />);
    expect(screen.getByText("AE")).toBeInTheDocument();
    rerender(<MemberAvatar name="Ada Example" photoUrl="https://example.com/a.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("AE")).toBeInTheDocument();
  });
});
