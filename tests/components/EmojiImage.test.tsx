// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import EmojiImage from "@/components/EmojiImage";

describe("EmojiImage", () => {
  it("is just the image when it has a still or does not move", () => {
    const { container, rerender } = render(<EmojiImage name="party" url="https://cdn.test/a.gif" still="https://cdn.test/a.still.png" />);
    expect(screen.getByRole("img", { name: ":party:" })).toHaveAttribute("data-still", "https://cdn.test/a.still.png");
    expect(container.querySelector("[data-no-still], [data-emoji-fallback]")).toBeNull();
    rerender(<EmojiImage name="flat" url="https://cdn.test/b.png" />);
    expect(container.querySelector("[data-no-still], [data-emoji-fallback]")).toBeNull();
  });

  it("leaves a copy of ours without a still alone: it has one frame", () => {
    const { container } = render(<EmojiImage name="still-gif" url="https://cdn.test/slack-emoji/x.gif" stored />);
    expect(container.querySelector("[data-no-still], [data-emoji-fallback]")).toBeNull();
  });

  it("pairs a moving image that has no still with its :name: text, for Animations off to swap in", () => {
    const { container } = render(<EmojiImage name="dance" url="https://slack.test/dance.gif" />);
    expect(screen.getByRole("img", { name: ":dance:" })).toHaveAttribute("data-no-still");
    const text = container.querySelector("[data-emoji-fallback]") as HTMLElement;
    expect(text).toHaveTextContent(":dance:");
    expect(text).toHaveAttribute("hidden");
  });
});
