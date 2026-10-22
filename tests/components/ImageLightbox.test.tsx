// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ImageLightbox from "@/components/ImageLightbox";

beforeEach(cleanup);
const IMAGES = [{ src: "/a", name: "A" }, { src: "/b" }, { src: "/c", name: "C" }];

describe("ImageLightbox", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<ImageLightbox images={[]} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("clamps the start index and labels unnamed images", () => {
    render(<ImageLightbox images={IMAGES} startIndex={99} onClose={vi.fn()} />);
    expect(screen.getByAltText("C")).toHaveAttribute("src", "/c");
    cleanup();
    render(<ImageLightbox images={IMAGES} startIndex={-4} onClose={vi.fn()} />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "/a");
    cleanup();
    render(<ImageLightbox images={[{ src: "/x" }]} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Image preview" })).toBeInTheDocument();
  });

  it("steps with the arrow keys and buttons but stops at both ends, and shows no arrows for one image", async () => {
    const { container } = render(<ImageLightbox images={IMAGES} onClose={vi.fn()} />);
    const img = () => container.querySelector("img");
    expect(screen.getByRole("button", { name: "Previous image" })).toBeDisabled();
    await userEvent.keyboard("{ArrowLeft}");
    expect(img()).toHaveAttribute("src", "/a");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(img()).toHaveAttribute("src", "/c");
    expect(screen.getByRole("button", { name: "Next image" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(img()).toHaveAttribute("src", "/b");
    await userEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(img()).toHaveAttribute("src", "/c");
    cleanup();
    render(<ImageLightbox images={[IMAGES[0]]} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Next image" })).not.toBeInTheDocument();
  });

  it("closes on Escape, the close button and the backdrop, but not on a click on the image", async () => {
    const onClose = vi.fn();
    render(<ImageLightbox images={IMAGES} onClose={onClose} />);
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(onClose).toHaveBeenCalled();
    onClose.mockClear();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
