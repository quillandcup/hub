// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ editChatMessage: vi.fn(), deleteChatMessage: vi.fn() }));
import { deleteChatMessage, editChatMessage } from "@/app/(member)/chat/actions";
import MessageBody from "@/components/chat/MessageBody";
import { onPoke, optimisticView } from "@/lib/chat/list-events";

const CTX: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const mine = (extra: Partial<ChatMessageView> = {}): ChatMessageView & { body: string } => ({
  ...optimisticView({ id: "m1", body: "first draft", viewer: { memberId: "member-fern", name: "Fern", photoUrl: null } }),
  syncStatus: null,
  ...extra,
  body: "first draft",
});
const mount = (message = mine(), canEdit = true) => render(<MessageBody message={message} ctx={CTX} channelId="c1" canEdit={canEdit} />);

beforeEach(() => {
  cleanup();
  refresh.mockReset();
  vi.mocked(editChatMessage).mockReset();
  vi.mocked(deleteChatMessage).mockReset();
});

describe("MessageBody", () => {
  it("offers Edit and Delete only on the viewer's own sent Hub message, with editing allowed", () => {
    mount();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    for (const [message, canEdit] of [
      [mine({ mine: false }), true], // someone else's
      [mine({ fromHub: false }), true], // written in Slack
      [mine({ syncStatus: "failed" }), true], // not in Slack yet
      [mine({ id: "pending-1" }), true], // not saved yet
      [mine(), false], // no preview, sudo, archived
    ] as const) {
      cleanup();
      mount(message, canEdit);
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.getByText("first draft")).toBeInTheDocument();
    }
  });

  it("edits in place: Enter saves, the new text shows at once and the conversation is asked to catch up", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
    const poked = vi.fn();
    const off = onPoke("c1", poked);
    mount();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
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

  it("falls back to a page refresh when no live conversation is open", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: true });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByRole("textbox"), "!{Enter}");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("cancels with Escape or Cancel, and saves nothing for unchanged or empty text", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByRole("textbox"), " more{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("first draft")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByRole("textbox"), "{Enter}"); // unchanged
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(editChatMessage).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the reason when the edit is refused", async () => {
    vi.mocked(editChatMessage).mockResolvedValue({ ok: false, error: "That message is no longer in Slack." });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByRole("textbox"), "!{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer in Slack");
    expect(screen.getByRole("textbox")).toHaveValue("first draft!");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks before deleting, then shows the tombstone at once", async () => {
    vi.mocked(deleteChatMessage).mockResolvedValue({ ok: true });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/Delete this message\?/)).toBeInTheDocument();
    expect(deleteChatMessage).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(deleteChatMessage).toHaveBeenCalledWith("m1"));
    expect(await screen.findByText("This message was deleted.")).toBeInTheDocument();
    expect(screen.queryByText("first draft")).not.toBeInTheDocument();
  });

  it("keeps the message when 'Keep' is chosen or Slack won't delete it", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByText("first draft")).toBeInTheDocument();

    vi.mocked(deleteChatMessage).mockResolvedValue({ ok: false, error: "Slack won't let this message be deleted." });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Slack won't let this message be deleted.");
    expect(screen.getByText("first draft")).toBeInTheDocument();
  });
});
