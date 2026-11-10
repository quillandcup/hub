// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/courses/LessonPlayer", () => ({
  default: (props: { title: string; playbackId: string; lessonId?: string; chatMessageId?: string; resumeSeconds?: number; trackProgress?: boolean; autoPlay?: boolean; posterUrl?: string | null }) => (
    <div
      data-testid="player"
      data-playback={props.playbackId}
      data-lesson={props.lessonId}
      data-message={props.chatMessageId}
      data-resume={props.resumeSeconds}
      data-tracking={String(Boolean(props.trackProgress))}
      data-autoplay={String(Boolean(props.autoPlay))}
      data-poster={props.posterUrl ?? ""}
    >
      {props.title}
    </div>
  ),
}));
import ChatVideo from "@/components/chat/ChatVideo";

const MESSAGE = "msg_AAAAAAAAAAA1";
const TOKENS = { playback: "p", poster: "s", storyboard: "b" };
const WATCHABLE = { title: "Show up for the page", courseTitle: "The Ready Writer", thumbnailUrl: "/api/courses/image/lesson/les_AAAAAAAAAAA1", canWatch: true };
const PLAYBACK = { title: "Show up for the page", lessonId: "les_AAAAAAAAAAA1", playbackId: "pb123", tokens: TOKENS, restricted: false, record: true, resumeSeconds: 95 };

const fetchMock = vi.fn();
/** The card info (GET) and the playback links (POST), each answered with a status and body. */
function answers(info: { status: number; body?: unknown } | "fail", play?: { status: number; body?: unknown } | "fail") {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const a = init?.method === "POST" ? play : info;
    if (a === "fail" || a === undefined) throw new Error("offline");
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body ?? {} };
  });
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("ChatVideo", () => {
  it("shows the lesson's title, its course and its thumbnail without minting any playback link", async () => {
    answers({ status: 200, body: WATCHABLE });
    const { container } = render(<ChatVideo messageId={MESSAGE} />);

    expect(await screen.findByText("From The Ready Writer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Show up for the page" })).toBeEnabled();
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/courses/image/lesson/les_AAAAAAAAAAA1");
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/videos/${MESSAGE}`);
    expect(posts()).toHaveLength(0);
  });

  it("opens the course player and starts it with one click, recording the watching against the message", async () => {
    answers({ status: 200, body: WATCHABLE }, { status: 200, body: PLAYBACK });
    render(<ChatVideo messageId={MESSAGE} />);

    await userEvent.click(await screen.findByRole("button", { name: "Play Show up for the page" }));

    const player = await screen.findByTestId("player");
    expect(posts()).toHaveLength(1);
    expect(player).toHaveAttribute("data-autoplay", "true");
    expect(player).toHaveAttribute("data-playback", "pb123");
    expect(player).toHaveAttribute("data-lesson", "les_AAAAAAAAAAA1");
    expect(player).toHaveAttribute("data-message", MESSAGE);
    expect(player).toHaveAttribute("data-resume", "95");
    expect(player).toHaveAttribute("data-tracking", "true");
  });

  it("gives the player the card's thumbnail as its poster, so opening it doesn't swap to a different frame first", async () => {
    answers({ status: 200, body: WATCHABLE }, { status: 200, body: PLAYBACK });
    render(<ChatVideo messageId={MESSAGE} />);

    await userEvent.click(await screen.findByRole("button", { name: /Play/ }));

    expect(await screen.findByTestId("player")).toHaveAttribute("data-poster", "/api/courses/image/lesson/les_AAAAAAAAAAA1");
  });

  it("gives it no poster when the card has no thumbnail, or its thumbnail wouldn't load", async () => {
    answers({ status: 200, body: { ...WATCHABLE, thumbnailUrl: null } }, { status: 200, body: PLAYBACK });
    const first = render(<ChatVideo messageId={MESSAGE} />);
    await userEvent.click(await screen.findByRole("button", { name: /Play/ }));
    expect(await screen.findByTestId("player")).toHaveAttribute("data-poster", "");
    first.unmount();

    answers({ status: 200, body: WATCHABLE }, { status: 200, body: PLAYBACK });
    const second = render(<ChatVideo messageId={MESSAGE} />);
    await screen.findByText("From The Ready Writer");
    second.container.querySelector("img")!.dispatchEvent(new Event("error"));
    await waitFor(() => expect(second.container.querySelector("img")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(await screen.findByTestId("player")).toHaveAttribute("data-poster", "");
  });

  it("doesn't record when the server says not to (sudo, a lesson only staff can open)", async () => {
    answers({ status: 200, body: WATCHABLE }, { status: 200, body: { ...PLAYBACK, record: false, resumeSeconds: 0 } });
    render(<ChatVideo messageId={MESSAGE} />);

    await userEvent.click(await screen.findByRole("button", { name: /Play/ }));

    expect(await screen.findByTestId("player")).toHaveAttribute("data-tracking", "false");
  });

  it("tells a viewer who can't watch it so on the card, with nothing to press", async () => {
    answers({ status: 200, body: { ...WATCHABLE, canWatch: false } });
    render(<ChatVideo messageId={MESSAGE} />);

    expect(await screen.findByText(/Part of The Ready Writer\. You need access to the course to watch it\./)).toBeInTheDocument();
    expect(screen.getByText("Show up for the page")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("is still pressable when the card info can't be had, and falls back to the generic text", async () => {
    answers("fail", { status: 200, body: PLAYBACK });
    render(<ChatVideo messageId={MESSAGE} />);

    expect(screen.getByText("A lesson video from a course")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Play Lesson video" }));
    expect(await screen.findByTestId("player")).toBeInTheDocument();
  });

  it("turns into the can't-watch card when the server refuses the playback after all (access changed since the card loaded)", async () => {
    answers({ status: 404 }, { status: 403 });
    render(<ChatVideo messageId={MESSAGE} />);

    await userEvent.click(screen.getByRole("button", { name: /Play/ }));

    expect(await screen.findByText(/You need access to the course to watch it/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    [429, /too many videos/i],
    [404, /isn't available right now/],
  ])("explains a %s answer and lets the viewer try again", async (status, message) => {
    answers({ status: 200, body: WATCHABLE }, { status });
    render(<ChatVideo messageId={MESSAGE} />);

    await userEvent.click(await screen.findByRole("button", { name: /Play/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: /Play/ })).toBeEnabled();
  });

  it("explains a network failure", async () => {
    answers({ status: 200, body: WATCHABLE }, "fail");
    render(<ChatVideo messageId={MESSAGE} />);

    await userEvent.click(await screen.findByRole("button", { name: /Play/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/isn't available right now/));
  });

  it("drops a thumbnail that won't load, keeping the card", async () => {
    answers({ status: 200, body: WATCHABLE });
    const { container } = render(<ChatVideo messageId={MESSAGE} />);
    await screen.findByText("From The Ready Writer");

    container.querySelector("img")!.dispatchEvent(new Event("error"));

    await waitFor(() => expect(container.querySelector("img")).toBeNull());
    expect(screen.getByRole("button", { name: /Play/ })).toBeInTheDocument();
  });
});
