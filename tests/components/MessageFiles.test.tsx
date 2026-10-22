// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import MessageFiles from "@/components/chat/MessageFiles";
import { chatFileUrl, formatFileSize, parseChatFiles } from "@/lib/chat/files";

describe("MessageFiles", () => {
  it("shows images and GIFs inline and other files as downloads", () => {
    const files = parseChatFiles([
      { id: "F1", name: "hedgie.gif", mimetype: "image/gif", width: 400, height: 300 },
      { id: "F2", name: "notes.pdf", mimetype: "application/pdf", size: 2048 },
      { id: "F3", name: "logo.svg", mimetype: "image/svg+xml" },
    ]);
    render(<MessageFiles messageId="m1" files={files} />);

    const img = screen.getByRole("img", { name: "hedgie.gif" });
    expect(img).toHaveAttribute("src", chatFileUrl("m1", "F1"));
    expect(img).toHaveAttribute("width", "400");
    const pdf = screen.getByRole("link", { name: /notes\.pdf/ });
    expect(pdf).toHaveAttribute("href", chatFileUrl("m1", "F2"));
    expect(pdf).toHaveTextContent("2 KB");
    // SVG can carry script, so it is a download, not an <img> on our pages.
    expect(screen.queryByRole("img", { name: "logo.svg" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /logo\.svg/ })).toBeInTheDocument();
  });

  it("renders nothing without files", () => {
    const { container } = render(<MessageFiles messageId="m1" files={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("chat file helpers", () => {
  it("parses defensively and formats sizes", () => {
    expect(parseChatFiles(null)).toEqual([]);
    expect(parseChatFiles([{ name: "no id" }, { id: "F1", size: "big" }])).toEqual([{ id: "F1", name: null, mimetype: null, size: null, width: null, height: null }]);
    expect([formatFileSize(null), formatFileSize(10), formatFileSize(2048), formatFileSize(3 * 1024 * 1024)]).toEqual(["", "10 B", "2 KB", "3.0 MB"]);
  });
});
