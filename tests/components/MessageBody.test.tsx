// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ editChatMessage: vi.fn(), deleteChatMessage: vi.fn(), deleteChatFile: vi.fn() }));
vi.mock("@/lib/chat/upload-client", () => ({ uploadStagedFiles: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
import { uploadStagedFiles } from "@/lib/chat/upload-client";
vi.mock("@/app/(member)/chat/mention-actions", () => ({ suggestMentions: vi.fn() }));
import { suggestMentions } from "@/app/(member)/chat/mention-actions";
import { deleteChatFile, deleteChatMessage, editChatMessage } from "@/app/(member)/chat/actions";
import MessageBody from "@/components/chat/MessageBody";
import { messageBox, typeInto, boxUser } from "../helpers/message-box";
import { MESSAGE_CHANGE_EVENT, onPoke, optimisticView } from "@/lib/chat/list-events";

const CTX: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const mine = (extra: Partial<ChatMessageView> = {}): ChatMessageView & { body: string } => ({
  ...optimisticView({ id: "m1", body: "first draft", viewer: { memberId: "member-fern", name: "Fern", photoUrl: null } }),
  syncStatus: null,
  ...extra,
  body: "first draft",
});
const mount = (message = mine(), canEdit = true, ctx: ChatTextContext = CTX) => render(<MessageBody message={message} ctx={ctx} channelId="c1" canEdit={canEdit} />);

const fire = (what: "edit" | "delete", messageId = "m1") =>
  act(() => {
    window.dispatchEvent(new CustomEvent(MESSAGE_CHANGE_EVENT, { detail: { messageId, what } }));
  });

beforeEach(() => {
  cleanup();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  refresh.mockReset();
  vi.mocked(editChatMessage).mockReset();
  vi.mocked(suggestMentions).mockReset();
  vi.mocked(suggestMentions).mockResolvedValue([]);
  vi.mocked(deleteChatMessage).mockReset();
});

describe("MessageBody", () => {
  it("starts editing or deleting from the menu's event, only on the viewer's own sent Hub message", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    fire("delete", "other");
    expect(screen.queryByText(/Are you sure you want to delete this message\?/)).not.toBeInTheDocument();
    fire("delete");
    expect(screen.getByText(/Are you sure you want to delete this message\?/)).toBeInTheDocument();

    for (const [message, canEdit] of [
      [mine({ mine: false }), true], // someone else's
      [mine({ system: true }), true], // a notice Slack posted
      [mine({ syncStatus: "failed" }), true], // not in Slack yet
      [mine({ id: "pending-1" }), true], // not saved yet
      [mine(), false], // no preview, sudo, archived
    ] as const) {
      cleanup();
      mount(message, canEdit);
      fire("edit");
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByText("first draft")).toBeInTheDocument();
    }
  });

  it("edits in place: Enter saves, the new text shows at once and the conversation is asked to catch up", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
    const poked = vi.fn();
    const off = onPoke("c1", poked);
    mount();

    fire("edit");
    const box = await messageBox("Edit message");
    expect(box.textContent).toBe("first draft");
    await boxUser().clear(box);
    await typeInto(box, "second draft{Enter}");

    await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", "second draft"));
    expect(await screen.findByText("second draft")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(poked).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    off();
  });

  it("ignores a second save while one is still going", async () => {
    vi.mocked(editChatMessage).mockReturnValue(new Promise(() => {}));
    mount();
    fire("edit");
    const box = await messageBox("Edit message");
    await boxUser().clear(box);
    await typeInto(box, "second draft{Enter}");
    await waitFor(() => expect(editChatMessage).toHaveBeenCalledTimes(1));
    await typeInto(box, "{Enter}");
    expect(editChatMessage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Delete message" })).not.toBeInTheDocument();
  });

  describe("a message written in Slack", () => {
    const NAMED: ChatTextContext = { ...CTX, userNames: { U1: "Ania Ray" }, channelNames: { C1: "general" } };
    const slackWritten = (body: string) => ({ ...mine({ fromHub: false }), body });

    it("shows people, channels and links by name in the edit box, and sends Slack's markup back", async () => {
      vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
      mount(slackWritten("hi <@U1> in <#C1|general>, see <https://example.test/a|the doc> &amp; more"), true, NAMED);

      fire("edit");
      const box = await messageBox("Edit message");
      expect(box.textContent).toBe("hi @Ania Ray in #general, see the doc & more");

      await typeInto(box, " thanks{Enter}");
      await waitFor(() =>
        expect(editChatMessage).toHaveBeenCalledWith("m1", "hi <@U1> in <#C1|general>, see <https://example.test/a|the doc> &amp; more thanks")
      );
    });

    it("adds a person picked while editing as a real mention, next to the ones that were there", async () => {
      vi.mocked(suggestMentions).mockResolvedValue([{ label: "@Sam Lee", token: "<@U2>", photoUrl: null }]);
      vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
      mount(slackWritten("hi <@U1> &amp; co"), true, NAMED);
      fire("edit");
      const box = await messageBox("Edit message");
      await typeInto(box, " and @sa");
      await userEvent.click(await screen.findByRole("option", { name: /Sam Lee/ }));
      await typeInto(box, "{Enter}");
      await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", "hi <@U1> &amp; co and <@U2>"));
    });

    it("escapes what is typed for Slack, and saves nothing when the text is unchanged", async () => {
      vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
      mount(slackWritten("hi <@U1>"), true, NAMED);
      fire("edit");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(editChatMessage).not.toHaveBeenCalled();

      fire("edit");
      await typeInto(await messageBox(), " a < b & c{Enter}");
      await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", "hi <@U1> a &lt; b &amp; c"));
    });
  });

  it("edits a Hub message as plain text with its people by name, and adds a picked person as a token", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([{ label: "@Sam Lee", token: "<@U2>", photoUrl: null }]);
    vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
    const named: ChatTextContext = { ...CTX, userNames: { U1: "Ania Ray" } };
    mount({ ...mine(), body: "a < b & <@U1>" }, true, named);
    fire("edit");
    const box = await messageBox("Edit message");
    expect(box.textContent).toBe("a < b & @Ania Ray");
    await typeInto(box, " @sa");
    await userEvent.click(await screen.findByRole("option", { name: /Sam Lee/ }));
    await typeInto(box, "{Enter}");
    await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", "a < b & <@U1> <@U2>"));
  });

  it("shows a quote in the edit box as a quote and saves it back as one, for a message written in Slack or the Hub", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
    for (const [fromHub, body, saved] of [
      [false, "&gt; Test - can only send in slack", "> Test - can only send in slack and a &amp; b"],
      [true, "&gt; Test - can only send in slack", "> Test - can only send in slack and a & b"],
      [true, "> Test - can only send in slack", "> Test - can only send in slack and a & b"],
    ] as const) {
      cleanup();
      vi.mocked(editChatMessage).mockClear();
      mount({ ...mine({ fromHub }), body });
      fire("edit");
      const box = await messageBox("Edit message");
      expect(box.querySelector("blockquote")).not.toBeNull();
      expect(box.textContent).toBe("Test - can only send in slack");
      await typeInto(box, " and a & b{Enter}");
      await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", saved));
    }
  });

  describe("files in the edit box", () => {
    const png = new File(["x"], "a.png", { type: "image/png" });
    const paste = (box: HTMLElement, files: File[]) => {
      const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
      e.clipboardData = { files, getData: () => "", types: ["Files"] };
      act(() => void box.dispatchEvent(e));
      return e;
    };
    const withFiles = () => ({ ...mine(), files: [{ id: "F1", name: "old.png", mimetype: "image/png", size: 10, width: null, height: null }] });

    beforeEach(() => {
      vi.mocked(uploadStagedFiles).mockReset();
      vi.mocked(uploadStagedFiles).mockResolvedValue({ ok: true, uploads: [{ path: "staging/x/a.png", name: "a.png", mimetype: "image/png", size: 1 }] });
      vi.mocked(deleteChatFile).mockReset();
      vi.mocked(deleteChatFile).mockResolvedValue({ ok: true });
    });

    it("shows the message's files as tiles, adds pasted, dropped and picked files beside them, and uploads them on Save", async () => {
      vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
      mount(withFiles());
      fire("edit");
      const box = await messageBox("Edit message");
      expect(screen.getByRole("button", { name: "Preview old.png" })).toBeInTheDocument();

      const pasted = paste(box, [png]);
      expect(pasted.defaultPrevented).toBe(true);
      expect(await screen.findByRole("button", { name: "Preview a.png" })).toBeInTheDocument();
      expect(box.textContent).toBe("first draft");

      const drop = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
      drop.dataTransfer = { types: ["Files"], files: [new File(["y"], "b.txt", { type: "text/plain" })] };
      act(() => void box.dispatchEvent(drop));
      expect(await screen.findByText("b.txt")).toBeInTheDocument();

      await userEvent.upload(screen.getByLabelText("Attach files", { selector: "input" }), new File(["z"], "c.txt", { type: "text/plain" }));
      expect(await screen.findByText("c.txt")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", "first draft", [expect.objectContaining({ name: "a.png" })]));
      expect(vi.mocked(uploadStagedFiles).mock.calls[0][0].map((f) => f.name)).toEqual(["a.png", "b.txt", "c.txt"]);
    });

    it("saves files added to a message whose text didn't change, and takes a removed file of the message off on Save", async () => {
      vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
      mount(withFiles());
      fire("edit");
      const box = await messageBox("Edit message");
      paste(box, [png]);
      await screen.findByRole("button", { name: "Preview a.png" });
      await userEvent.click(screen.getByRole("button", { name: "Remove old.png" }));
      expect(screen.queryByRole("button", { name: "Preview old.png" })).not.toBeInTheDocument();
      expect(deleteChatFile).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(deleteChatFile).toHaveBeenCalledWith("m1", "F1"));
      await waitFor(() => expect(editChatMessage).toHaveBeenCalledTimes(1));
    });

    it("takes a pending file off before saving, and the paperclip opens the file picker", async () => {
      mount();
      fire("edit");
      await messageBox("Edit message");
      const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
      await userEvent.click(screen.getByRole("button", { name: "Attach files" }));
      expect(click).toHaveBeenCalled();
      click.mockRestore();
      paste(await messageBox("Edit message"), [png]);
      await userEvent.click(await screen.findByRole("button", { name: "Remove a.png" }));
      expect(screen.queryByRole("button", { name: "Preview a.png" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(uploadStagedFiles).not.toHaveBeenCalled();
    });

    it("keeps the box open with the reason when the upload fails", async () => {
      vi.mocked(uploadStagedFiles).mockResolvedValue({ ok: false, error: "Couldn't upload a.png. Try again." });
      mount();
      fire("edit");
      paste(await messageBox("Edit message"), [png]);
      await screen.findByRole("button", { name: "Preview a.png" });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't upload a.png");
      expect(editChatMessage).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "Edit message" })).toBeInTheDocument();
    });

    it("refuses a file that is too big", async () => {
      mount();
      fire("edit");
      const big = new File(["x"], "big.bin");
      Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 * 1024 });
      paste(await messageBox("Edit message"), [big]);
      expect(await screen.findByRole("alert")).toHaveTextContent("big.bin is over");
    });
  });

  it("falls back to a page refresh when no live conversation is open", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
    mount();
    fire("edit");
    await typeInto(await messageBox(), "!{Enter}");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("cancels with Escape or Cancel, and saves nothing for unchanged text", async () => {
    mount();
    fire("edit");
    await typeInto(await messageBox(), " more{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("first draft")).toBeInTheDocument();

    fire("edit");
    await typeInto(await messageBox(), "{Enter}"); // unchanged
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fire("edit");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(editChatMessage).not.toHaveBeenCalled();
  });

  it("asks to delete when an emptied edit is saved, like Slack, and saves no edit", async () => {
    vi.mocked(deleteChatMessage).mockResolvedValue({ ok: true });
    mount();
    fire("edit");
    await boxUser().clear(await messageBox());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog", { name: "Delete message" })).toBeInTheDocument();
    expect(editChatMessage).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteChatMessage).toHaveBeenCalledWith("m1"));
  });

  it("keeps the editor open with the reason when the edit is refused", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: false, error: "That message is no longer in Slack." });
    mount();
    fire("edit");
    await typeInto(await messageBox(), "!{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer in Slack");
    expect((await messageBox()).textContent).toBe("first draft!");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks before deleting, then removes it at once", async () => {
    vi.mocked(deleteChatMessage).mockResolvedValue({ ok: true });
    mount();
    fire("delete");
    expect(screen.getByText(/Are you sure you want to delete this message\?/)).toBeInTheDocument();
    expect(deleteChatMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteChatMessage).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(screen.queryByText("This message was deleted.")).not.toBeInTheDocument());
    expect(screen.queryByText("first draft")).not.toBeInTheDocument();
  });

  it("closes the delete dialog with Escape or the X, deleting nothing", async () => {
    mount();
    fire("delete");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fire("delete");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteChatMessage).not.toHaveBeenCalled();
  });

  it("keeps the message when Cancel is chosen or Slack won't delete it", async () => {
    mount();
    fire("delete");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("first draft")).toBeInTheDocument();

    vi.mocked(deleteChatMessage).mockResolvedValue({ ok: false, error: "Slack won't let this message be deleted." });
    fire("delete");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Slack won't let this message be deleted.");
    expect(screen.getByText("first draft")).toBeInTheDocument();
  });

  it("hides the message's row in the feed at once when it is deleted", async () => {
    vi.mocked(deleteChatMessage).mockResolvedValue({ ok: true });
    const row = document.createElement("article");
    row.id = "m-m1";
    document.body.appendChild(row);
    mount();
    fire("delete");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(row.style.display).toBe("none"));
    row.remove();
  });
});
