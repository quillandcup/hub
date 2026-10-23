// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const uploadWithProgress = vi.fn();
vi.mock("@/lib/chat/upload-progress", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/upload-progress")>()), uploadWithProgress: (...a: unknown[]) => uploadWithProgress(...a) }));
vi.mock("@/app/(member)/chat/actions", () => ({ sendChatMessage: vi.fn(), retryChatMessage: vi.fn(), prepareChatUploads: vi.fn() }));
import { prepareChatUploads, retryChatMessage, sendChatMessage } from "@/app/(member)/chat/actions";
import Composer from "@/components/chat/Composer";
import RetryButton from "@/components/chat/RetryButton";

beforeEach(() => {
  cleanup();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  refresh.mockReset();
  vi.mocked(sendChatMessage).mockReset();
  vi.mocked(retryChatMessage).mockReset();
  vi.mocked(prepareChatUploads).mockReset();
  uploadWithProgress.mockReset();
});

describe("Composer", () => {
  it("sends on Enter, clears the box and refreshes the page", async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "m1" });
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Message #hosts" }), "Hello there{Enter}");

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith("c1", "Hello there", undefined, []));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("starts a new line on Shift+Enter instead of sending", async () => {
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await userEvent.type(screen.getByRole("textbox"), "one{Shift>}{Enter}{/Shift}two");
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("one\ntwo");
  });

  it("replies in a thread when given its root", async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "m2" });
    render(<Composer channelId="c1" threadRootId="root-1" placeholder="Reply…" />);
    await userEvent.type(screen.getByRole("textbox"), "yes{Enter}");
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith("c1", "yes", "root-1", []));
  });

  it("keeps the text and says why when the post is refused", async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: false, error: "This conversation is archived." });
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await userEvent.type(screen.getByRole("textbox"), "still here{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("This conversation is archived.");
    expect(screen.getByRole("textbox")).toHaveValue("still here");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends nothing for a blank message", async () => {
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "   {Enter}");
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it("shows an upload overlay while files are dragged over the conversation, and attaches what is dropped", async () => {
    const { container } = render(
      <div id="col">
        <Composer channelId="c1" placeholder="Message #hosts" dropTargetIds={["col"]} />
      </div>
    );
    const column = container.firstElementChild as HTMLElement;
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    fireEvent.dragEnter(column, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(await screen.findByText("Upload to #hosts")).toBeInTheDocument();
    fireEvent.drop(column, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(await screen.findByText("notes.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Upload to #hosts")).not.toBeInTheDocument();
  });

  it("labels the overlay for a thread, and ignores a picker closed with no files", async () => {
    const { container } = render(
      <div id="col">
        <Composer channelId="c1" placeholder="Reply" threadRootId="t1" dropTargetIds={["col"]} />
      </div>
    );
    fireEvent.dragEnter(container.firstElementChild as HTMLElement, { dataTransfer: { types: ["Files"], files: [] } });
    expect(await screen.findByText("Upload to thread")).toBeInTheDocument();
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [] } });
    expect(screen.queryByRole("list", { name: "Attached files" })).not.toBeInTheDocument();
  });

  it("opens the file picker from the paperclip", async () => {
    const { container } = render(<Composer channelId="c1" placeholder="Message #hosts" />);
    const click = vi.spyOn(container.querySelector('input[type="file"]') as HTMLInputElement, "click");
    await userEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(click).toHaveBeenCalled();
  });
});

describe("Composer attachments", () => {
  const cat = () => new File(["gif"], "cat.gif", { type: "image/gif" });
  const attach = (...files: File[]) => userEvent.upload(screen.getByLabelText("Attach files", { selector: "input" }), files);

  it("uploads attachments straight to storage, then sends the message with them (no text needed)", async () => {
    vi.mocked(prepareChatUploads).mockResolvedValue({ ok: true, uploads: [{ path: "staging/d/m-1/cat.gif", token: "tok" }] });
    uploadWithProgress.mockResolvedValue({ ok: true });
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "m1" });
    render(<Composer channelId="c1" placeholder="Message #hosts" />);

    await attach(cat());
    expect(screen.getByRole("button", { name: "Preview cat.gif" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());
    expect(prepareChatUploads).toHaveBeenCalledWith([{ name: "cat.gif", size: 3 }]);
    expect(uploadWithProgress).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/object/upload/sign/slack-files/staging/d/m-1/cat.gif?token=tok"), file: expect.any(File), contentType: "image/gif" }));
    expect(sendChatMessage).toHaveBeenCalledWith("c1", "", undefined, [{ path: "staging/d/m-1/cat.gif", name: "cat.gif", mimetype: "image/gif", size: 3 }]);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Attached files" })).not.toBeInTheDocument());
  });

  it("shows byte progress overall and on each file while uploading, and stays quiet when aborted", async () => {
    vi.mocked(prepareChatUploads).mockResolvedValue({
      ok: true,
      uploads: [
        { path: "p1", token: "t" },
        { path: "p2", token: "t" },
      ],
    });
    let finish!: (r: { ok: true }) => void;
    uploadWithProgress.mockImplementationOnce(({ onProgress }: { onProgress: (n: number) => void }) => {
      onProgress(2);
      return new Promise((r) => (finish = r));
    });
    uploadWithProgress.mockResolvedValueOnce({ ok: false, reason: "aborted" });
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "m1" });
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await attach(new File(["abcd"], "a.txt", { type: "text/plain" }), new File(["efgh"], "b.txt", { type: "text/plain" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("25% uploaded")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Uploading a.txt" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("progressbar", { name: "Uploading b.txt" })).toHaveAttribute("aria-valuenow", "0");
    finish({ ok: true });
    await waitFor(() => expect(uploadWithProgress).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it("lets an attachment be removed, and takes pasted images", async () => {
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await attach(cat());
    await userEvent.click(screen.getByRole("button", { name: "Remove cat.gif" }));
    expect(screen.queryByRole("list", { name: "Attached files" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    screen.getByRole("textbox").focus();
    await userEvent.paste({ files: [new File(["png"], "shot.png", { type: "image/png" })], getData: () => "", types: ["Files"] } as unknown as DataTransfer);
    expect(screen.getByRole("button", { name: "Preview shot.png" })).toBeInTheDocument();
  });

  it("refuses a file over the limit and keeps the attachments when an upload fails", async () => {
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await attach(new File([new Uint8Array(21 * 1024 * 1024)], "big.mov", { type: "video/quicktime" }));
    expect(screen.getByRole("alert")).toHaveTextContent("big.mov is over 20 MB");

    vi.mocked(prepareChatUploads).mockResolvedValue({ ok: true, uploads: [{ path: "p", token: "t" }] });
    uploadWithProgress.mockResolvedValue({ ok: false, reason: "http", status: 500 });
    await attach(cat());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't upload cat.gif");
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("list", { name: "Attached files" })).toBeInTheDocument();
  });

  it("shows why when storage can't be prepared", async () => {
    vi.mocked(prepareChatUploads).mockResolvedValue({ ok: false, error: "Attach up to 10 files at a time." });
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await attach(cat());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Attach up to 10 files");
  });
});

describe("Composer drag and drop", () => {
  it("shows an upload overlay while files are dragged over the column and attaches the drop", () => {
    const { container } = render(
      <div id="col">
        <Composer channelId="c1" placeholder="Message #hosts" dropTargetIds={["col"]} />
      </div>,
    );
    const column = container.firstElementChild as HTMLElement;
    const file = new File(["x"], "drop.txt", { type: "text/plain" });
    const dataTransfer = { types: ["Files"], files: [file] };
    fireEvent.dragEnter(column, { dataTransfer });
    expect(screen.getByText("Upload to #hosts")).toBeInTheDocument();
    fireEvent.drop(column, { dataTransfer });
    expect(screen.queryByText("Upload to #hosts")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Attached files" })).toHaveTextContent("drop.txt");
  });

  it("labels the overlay for a thread", () => {
    const { container } = render(
      <div id="col">
        <Composer channelId="c1" threadRootId="r" placeholder="Reply…" dropTargetIds={["col"]} />
      </div>,
    );
    fireEvent.dragEnter(container.firstElementChild as HTMLElement, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.getByText("Upload to thread")).toBeInTheDocument();
  });
});

describe("Composer drop on another panel", () => {
  it("accepts a drop on the profile panel, and ignores one that is not on the page", () => {
    render(
      <div>
        <aside id="profile">Profile</aside>
        <Composer channelId="c1" placeholder="Message #hosts" dropTargetIds={["missing", "profile"]} />
      </div>,
    );
    const dataTransfer = { types: ["Files"], files: [new File(["x"], "p.txt", { type: "text/plain" })] };
    fireEvent.dragEnter(screen.getByText("Profile"), { dataTransfer });
    expect(screen.getByText("Upload to #hosts")).toBeInTheDocument();
    fireEvent.drop(screen.getByText("Profile"), { dataTransfer });
    expect(screen.getByRole("list", { name: "Attached files" })).toHaveTextContent("p.txt");
  });

  it("does nothing on a drop without targets", () => {
    const { container } = render(
      <div>
        <Composer channelId="c1" placeholder="Message #hosts" />
      </div>,
    );
    fireEvent.dragEnter(container.firstElementChild as HTMLElement, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.queryByText("Upload to #hosts")).not.toBeInTheDocument();
  });
});

describe("RetryButton", () => {
  it("retries and refreshes when Slack takes the message", async () => {
    vi.mocked(retryChatMessage).mockResolvedValue({ ok: true, id: "m1" });
    render(<RetryButton channelId="c1" messageId="m1" />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(retryChatMessage).toHaveBeenCalledWith("m1");
  });

  it("shows the reason when it fails again", async () => {
    vi.mocked(retryChatMessage).mockResolvedValue({ ok: false, error: "Slack didn't take it. Try again in a moment." });
    render(<RetryButton channelId="c1" messageId="m1" />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Slack didn't take it");
    expect(refresh).not.toHaveBeenCalled();
  });
});
