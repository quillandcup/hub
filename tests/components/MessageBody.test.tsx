// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ editChatMessage: vi.fn(), deleteChatMessage: vi.fn() }));
import { deleteChatMessage, editChatMessage } from "@/app/(member)/chat/actions";
import MessageBody from "@/components/chat/MessageBody";
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
  refresh.mockReset();
  vi.mocked(editChatMessage).mockReset();
  vi.mocked(deleteChatMessage).mockReset();
});

describe("MessageBody", () => {
  it("starts editing or deleting from the menu's event, only on the viewer's own sent Hub message", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    fire("delete", "other");
    expect(screen.queryByText(/Delete this message\?/)).not.toBeInTheDocument();
    fire("delete");
    expect(screen.getByText(/Delete this message\?/)).toBeInTheDocument();

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
    const box = screen.getByRole("textbox", { name: "Edit message" });
    expect(box).toHaveValue("first draft");
    await userEvent.clear(box);
    await userEvent.type(box, "second draft{Enter}");

    await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", "second draft"));
    expect(await screen.findByText("second draft")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(poked).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    off();
  });

  describe("a message written in Slack", () => {
    const NAMED: ChatTextContext = { ...CTX, userNames: { U1: "Ania Ray" }, channelNames: { C1: "general" } };
    const slackWritten = (body: string) => ({ ...mine({ fromHub: false }), body });

    it("shows people, channels and links by name in the edit box, and sends Slack's markup back", async () => {
      vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
      mount(slackWritten("hi <@U1> in <#C1|general>, see <https://example.test/a|the doc> &amp; more"), true, NAMED);

      fire("edit");
      const box = screen.getByRole("textbox", { name: "Edit message" });
      expect(box).toHaveValue("hi @Ania Ray in #general, see the doc & more");

      await userEvent.type(box, " thanks{Enter}");
      await waitFor(() =>
        expect(editChatMessage).toHaveBeenCalledWith("m1", "hi <@U1> in <#C1|general>, see <https://example.test/a|the doc> &amp; more thanks")
      );
    });

    it("escapes what is typed for Slack, and saves nothing when the text is unchanged", async () => {
      vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
      mount(slackWritten("hi <@U1>"), true, NAMED);
      fire("edit");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(editChatMessage).not.toHaveBeenCalled();

      fire("edit");
      await userEvent.type(screen.getByRole("textbox"), " a < b & c{Enter}");
      await waitFor(() => expect(editChatMessage).toHaveBeenCalledWith("m1", "hi <@U1> a &lt; b &amp; c"));
    });
  });

  it("falls back to a page refresh when no live conversation is open", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
    mount();
    fire("edit");
    await userEvent.type(screen.getByRole("textbox"), "!{Enter}");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("cancels with Escape or Cancel, and saves nothing for unchanged or empty text", async () => {
    mount();
    fire("edit");
    await userEvent.type(screen.getByRole("textbox"), " more{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("first draft")).toBeInTheDocument();

    fire("edit");
    await userEvent.type(screen.getByRole("textbox"), "{Enter}"); // unchanged
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fire("edit");
    await userEvent.clear(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(editChatMessage).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the reason when the edit is refused", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: false, error: "That message is no longer in Slack." });
    mount();
    fire("edit");
    await userEvent.type(screen.getByRole("textbox"), "!{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer in Slack");
    expect(screen.getByRole("textbox")).toHaveValue("first draft!");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks before deleting, then removes it at once", async () => {
    vi.mocked(deleteChatMessage).mockResolvedValue({ ok: true });
    mount();
    fire("delete");
    expect(screen.getByText(/Delete this message\?/)).toBeInTheDocument();
    expect(deleteChatMessage).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteChatMessage).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(screen.queryByText("This message was deleted.")).not.toBeInTheDocument());
    expect(screen.queryByText("first draft")).not.toBeInTheDocument();
  });

  it("keeps the message when 'Keep' is chosen or Slack won't delete it", async () => {
    mount();
    fire("delete");
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
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
