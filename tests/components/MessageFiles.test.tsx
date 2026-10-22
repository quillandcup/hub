// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteChatFile } = vi.hoisted(() => ({ deleteChatFile: vi.fn() }));
vi.mock("@/app/(member)/chat/actions", () => ({ deleteChatFile }));
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

describe("MessageFiles attachments", () => {
  const files = parseChatFiles([
    { id: "F1", name: "a.png", mimetype: "image/png" },
    { id: "F2", name: "b.png", mimetype: "image/png" },
  ]);
  beforeEach(() => {
    deleteChatFile.mockReset();
    vi.restoreAllMocks();
  });

  it("shows a count header that collapses and expands the files", async () => {
    render(<MessageFiles messageId="m1" files={files} />);
    const toggle = screen.getByRole("button", { name: /2 attachments/ });
    expect(screen.getAllByTestId("message-image")).toHaveLength(2);
    await userEvent.click(toggle);
    expect(screen.queryAllByTestId("message-image")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Download all" })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getAllByTestId("message-image")).toHaveLength(2);
  });

  it("enlarges an image and closes it", async () => {
    render(<MessageFiles messageId="m1" files={files} />);
    await userEvent.click(screen.getByRole("button", { name: "Enlarge a.png" }));
    expect(screen.getByRole("dialog", { name: "a.png" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers delete only to the owner, and removes the file once the action succeeds", async () => {
    const { unmount } = render(<MessageFiles messageId="m1" files={files} />);
    expect(screen.queryByRole("button", { name: "Remove a.png" })).not.toBeInTheDocument();
    unmount();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteChatFile.mockResolvedValue({ ok: true });
    render(<MessageFiles messageId="m1" files={files} canDelete />);
    await userEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    expect(deleteChatFile).toHaveBeenCalledWith("m1", "F1");
    await waitFor(() => expect(screen.queryByRole("img", { name: "a.png" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /1 attachment$/ })).toBeInTheDocument();
  });

  it("keeps the file and shows the error when delete fails or is cancelled", async () => {
    render(<MessageFiles messageId="m1" files={files} canDelete />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    expect(deleteChatFile).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    deleteChatFile.mockResolvedValue({ ok: false, error: "Slack said no." });
    await userEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Slack said no.");
    expect(screen.getByRole("img", { name: "a.png" })).toBeInTheDocument();
  });

  it("menu: copy link, open in new tab, download and owner-only delete", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { unmount } = render(<MessageFiles messageId="m1" files={files} />);
    await userEvent.click(screen.getAllByRole("button", { name: "More actions" })[0]);
    expect(screen.queryByRole("menuitem", { name: "Delete file" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open in new tab" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("menuitem", { name: "Download" })).toHaveAttribute("download", "a.png");
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(chatFileUrl("m1", "F1")));
    unmount();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteChatFile.mockResolvedValue({ ok: true });
    render(<MessageFiles messageId="m1" files={files} canDelete />);
    await userEvent.click(screen.getAllByRole("button", { name: "More actions" })[1]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete file" }));
    expect(deleteChatFile).toHaveBeenCalledWith("m1", "F2");
  });

  it("copy image falls back to the link, and Download all downloads each file", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<MessageFiles messageId="m1" files={files} />);
    await userEvent.click(screen.getAllByRole("button", { name: "More actions" })[0]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy image" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Download all" }));
    await vi.advanceTimersByTimeAsync(600);
    expect(click).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("MessageFiles image menu extras", () => {
  it("copies the image itself when the browser allows it, and closes the menu from links", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { write, writeText: vi.fn() }, configurable: true });
    vi.stubGlobal("ClipboardItem", class { constructor(public items: unknown) {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: async () => new Blob(["x"], { type: "image/png" }) }));
    const files = parseChatFiles([{ id: "F1", mimetype: "image/png" }]);
    render(<MessageFiles messageId="m1" files={files} />);
    expect(screen.getByRole("img", { name: "Image" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy image" }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    for (const name of ["Open in new tab", "Download"]) {
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));
      await userEvent.click(screen.getByRole("menuitem", { name }));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("MessageFiles without file names", () => {
  it("uses generic labels for an image and a file", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const files = parseChatFiles([
      { id: "F1", mimetype: "image/png" },
      { id: "F2", mimetype: "application/pdf" },
    ]);
    render(<MessageFiles messageId="m1" files={files} canDelete />);
    expect(screen.getByText("File")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("this file"));
    await userEvent.click(screen.getByRole("button", { name: "Enlarge image" }));
    expect(screen.getByRole("dialog", { name: "Image" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(screen.getByRole("button", { name: /2 attachments/ }));
    await userEvent.click(screen.getByRole("button", { name: "Download all" }));
    await vi.advanceTimersByTimeAsync(600);
    expect(click).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("chat file helpers", () => {
  it("parses defensively and formats sizes", () => {
    expect(parseChatFiles(null)).toEqual([]);
    expect(parseChatFiles([{ name: "no id" }, { id: "F1", size: "big" }])).toEqual([{ id: "F1", name: null, mimetype: null, size: null, width: null, height: null }]);
    expect([formatFileSize(null), formatFileSize(10), formatFileSize(2048), formatFileSize(3 * 1024 * 1024)]).toEqual(["", "10 B", "2 KB", "3.0 MB"]);
  });
});
