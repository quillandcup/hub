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
    render(<ImageLightbox images={[{ src: "/a", name: "A" }, { src: "/b", name: "B" }]} startIndex={0} onClose={onClose} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a");
    await userEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/b");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a");
    await userEvent.keyboard("x");
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a");
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PendingAttachments with a non-blob object URL", () => {
  it("shows the file chip instead of loading the image", () => {
    URL.createObjectURL = vi.fn(() => "javascript:alert(1)");
    render(<PendingAttachments files={[new File(["a"], "cat.png", { type: "image/png" })]} onRemove={vi.fn()} />);
    expect(screen.getByText("cat.png")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview cat.png" })).toBeNull();
  });
});

describe("PendingAttachments upload progress", () => {
  it("draws a ring per file with its percentage", () => {
    const files = [new File(["a"], "cat.png", { type: "image/png" }), new File(["b"], "notes.pdf", { type: "application/pdf" })];
    render(<PendingAttachments files={files} progress={[0.5]} onRemove={vi.fn()} />);
    expect(screen.getByRole("progressbar", { name: "Uploading cat.png" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("progressbar", { name: "Uploading notes.pdf" })).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("PendingAttachments kept files", () => {
  it("lists kept files before the others, previews a kept image from its link, and removes from the right list", async () => {
    const onRemove = vi.fn();
    const onRemoveKept = vi.fn();
    render(
      <PendingAttachments
        files={[new File(["b"], "new.pdf", { type: "application/pdf" })]}
        kept={[
          { name: "kept.png", size: 5, url: "https://storage.example/kept.png?token=t" },
          { name: "kept.pdf", size: 5, url: null },
          { name: "bad.png", size: 5, url: "javascript:alert(1)" },
        ]}
        onRemove={onRemove}
        onRemoveKept={onRemoveKept}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Remove kept.png", "Remove kept.pdf", "Remove bad.png", "Remove new.pdf"]);
    // A link that isn't http(s) or blob is never loaded as an image.
    expect(screen.queryByRole("button", { name: "Preview bad.png" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview kept.png" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://storage.example/kept.png?token=t");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Remove kept.pdf" }));
    expect(onRemoveKept).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole("button", { name: "Remove new.pdf" }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("draws no ring over a file given null progress", () => {
    render(<PendingAttachments files={[new File(["a"], "a.pdf"), new File(["b"], "b.pdf")]} progress={[null, 0.25]} onRemove={vi.fn()} />);
    expect(screen.queryByRole("progressbar", { name: "Uploading a.pdf" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Uploading b.pdf" })).toHaveAttribute("aria-valuenow", "25");
  });
});
