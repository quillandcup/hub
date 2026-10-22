// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import PendingAttachments from "@/components/chat/PendingAttachments";
import ImageLightbox from "@/components/ImageLightbox";

beforeEach(() => {
  cleanup();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

describe("PendingAttachments", () => {
  it("opens an enlarged preview of an image, removes files, and chips non-images", async () => {
    const onRemove = vi.fn();
    const files = [new File(["a"], "cat.png", { type: "image/png" }), new File(["b"], "notes.pdf", { type: "application/pdf" })];
    render(<PendingAttachments files={files} onRemove={onRemove} />);
    expect(screen.getByText("notes.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview cat.png" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove notes.pdf" }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});

describe("PendingAttachments without file names", () => {
  it("falls back to generic labels", async () => {
    const files = [new File(["a"], "", { type: "image/png" }), new File(["b"], "", { type: "application/pdf" })];
    render(<PendingAttachments files={files} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Preview image" }));
    expect(screen.getByRole("dialog", { name: "image" })).toBeInTheDocument();
    expect(screen.getByText("file")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove file" })).toHaveLength(2);
  });
});

describe("ImageLightbox", () => {
  it("steps through images and closes on backdrop click", async () => {
    const onClose = vi.fn();
    render(<ImageLightbox images={[{ src: "a", name: "A" }, { src: "b", name: "B" }]} startIndex={0} onClose={onClose} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "a");
    await userEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "b");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("img")).toHaveAttribute("src", "a");
    await userEvent.keyboard("x");
    expect(screen.getByRole("img")).toHaveAttribute("src", "a");
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });
});
