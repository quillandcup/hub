// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ sendChatMessage: vi.fn(), retryChatMessage: vi.fn() }));
import { retryChatMessage, sendChatMessage } from "@/app/(member)/chat/actions";
import Composer from "@/components/chat/Composer";
import RetryButton from "@/components/chat/RetryButton";

beforeEach(() => {
  cleanup();
  refresh.mockReset();
  vi.mocked(sendChatMessage).mockReset();
  vi.mocked(retryChatMessage).mockReset();
});

describe("Composer", () => {
  it("sends on Enter, clears the box and refreshes the page", async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "m1" });
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Message #hosts" }), "Hello there{Enter}");

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith("c1", "Hello there", undefined));
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
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith("c1", "yes", "root-1"));
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
});

describe("RetryButton", () => {
  it("retries and refreshes when Slack takes the message", async () => {
    vi.mocked(retryChatMessage).mockResolvedValue({ ok: true, id: "m1" });
    render(<RetryButton messageId="m1" />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(retryChatMessage).toHaveBeenCalledWith("m1");
  });

  it("shows the reason when it fails again", async () => {
    vi.mocked(retryChatMessage).mockResolvedValue({ ok: false, error: "Slack didn't take it. Try again in a moment." });
    render(<RetryButton messageId="m1" />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Slack didn't take it");
    expect(refresh).not.toHaveBeenCalled();
  });
});
