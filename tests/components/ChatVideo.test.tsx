// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/courses/LessonPlayer", () => ({
  default: (props: { title: string; playbackId: string; trackProgress?: boolean }) => (
    <div data-testid="player" data-playback={props.playbackId} data-tracking={String(Boolean(props.trackProgress))}>
      {props.title}
    </div>
  ),
}));
import ChatVideo from "@/components/chat/ChatVideo";

const fetchMock = vi.fn();
const answer = (status: number, body: unknown = {}) => fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("ChatVideo", () => {
  it("asks for nothing until play is pressed", () => {
    render(<ChatVideo messageId="msg_AAAAAAAAAAA1" />);

    expect(screen.getByRole("button", { name: /watch the video/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches playback links for the message and shows the course player, which records no views yet", async () => {
    answer(200, { title: "Show up for the page", playbackId: "pb123", tokens: { playback: "p", poster: "s", storyboard: "b" }, restricted: false });
    render(<ChatVideo messageId="msg_AAAAAAAAAAA1" />);

    await userEvent.click(screen.getByRole("button", { name: /watch the video/i }));

    const player = await screen.findByTestId("player");
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/videos/msg_AAAAAAAAAAA1", { method: "POST" });
    expect(player).toHaveAttribute("data-playback", "pb123");
    expect(player).toHaveAttribute("data-tracking", "false");
    expect(screen.getAllByText("Show up for the page").length).toBeGreaterThan(0);
  });

  it.each([
    [403, /part of a course you don't have access to/],
    [429, /too many videos/i],
    [404, /isn't available right now/],
  ])("explains a %s answer and lets the member try again", async (status, message) => {
    answer(status);
    render(<ChatVideo messageId="msg_AAAAAAAAAAA1" />);

    await userEvent.click(screen.getByRole("button", { name: /watch the video/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: /watch the video/i })).toBeEnabled();
  });

  it("explains a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<ChatVideo messageId="msg_AAAAAAAAAAA1" />);

    await userEvent.click(screen.getByRole("button", { name: /watch the video/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/isn't available right now/));
  });
});
